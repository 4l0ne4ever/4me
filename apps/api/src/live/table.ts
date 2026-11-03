import {
  arrive,
  command,
  listingOf,
  newTable,
  type Seat,
  type Table,
  type TableEvent,
  type TableListing,
  tableMessage,
  tick,
  viewFor,
} from "@4me/shared";

// One werewolf table, wherever it lives: a Durable Object per table in production (table-do.ts), memory in
// development and tests (MemoryTables below). The game itself is in @4me/shared; this keeps the table, hands it what
// players send and the clock, sends each of them their own view, and passes WebRTC messages between players.

/** A browser at the table. */
export type Conn = { uid: number; send(data: string): void; close?(code: number, reason: string): void };

export interface TableStore {
  conns(): Conn[];
  load(): Promise<Table | null>;
  save(t: Table | null): Promise<void>;
  /** Wakes the table at this time (a phase's end, or a check for an idle table). */
  schedule(at: number): Promise<void>;
  /** Tells the list of open tables about this one (null: take it off). */
  list(code: string, l: TableListing | null): Promise<void>;
}

/** An empty table is put away after this long; a table nobody touched for a day, too. */
const EMPTY_MS = 10 * 60_000;
const STALE_MS = 24 * 3600_000;
/** WebRTC offers are a few kilobytes; nothing a player sends is bigger. */
const MAX_MESSAGE = 32_000;

/** Players who gave a table's password, kept so they can sit (and come back); a bound against a table's growing. */
const MAX_ALLOWED = 64;

/** A table password's hash: PBKDF2 with a salt of its own, so the stored table never holds the password. */
async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 60_000 },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Unlock = "ok" | "open" | "wrong" | "gone";

export const fairRand = () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;

export class TableRoom {
  private table: Table | null | undefined;
  private listed = "";
  /** Chat lines per player in the last few seconds, against flooding. */
  private chatter = new Map<number, number[]>();

  constructor(
    private store: TableStore,
    private rand: () => number = fairRand,
    private clock: () => number = Date.now,
  ) {}

  private async get(): Promise<Table | null> {
    if (this.table === undefined) this.table = await this.store.load();
    return this.table;
  }

  /** A new table, with its host sitting at it. False when the code is taken. */
  async create(code: string, host: Seat): Promise<boolean> {
    if (await this.get()) return false;
    this.table = newTable(code, host, this.clock());
    // Nobody is connected yet: the host's browser joins in a moment.
    this.table.players[0]!.connected = false;
    await this.commit();
    return true;
  }

  /** A player's browser connected. An error means it should be told so and closed. */
  async join(seat: Seat): Promise<{ error: string } | null> {
    const t = await this.get();
    if (!t) return { error: "this table has been put away" };
    const r = arrive(t, seat, this.clock());
    if ("error" in r) return r;
    await this.commit();
    return null;
  }

  /** Someone gives the table's password: when it's right, they may sit down. */
  async unlock(uid: number, password: string): Promise<Unlock> {
    const t = await this.get();
    if (!t) return "gone";
    if (!t.lock) return "open";
    if (t.allowed?.includes(uid) || t.players.some((p) => p.id === uid)) return "ok";
    if (!sameText(await passwordHash(password, t.lock.salt), t.lock.hash)) return "wrong";
    t.allowed = [...(t.allowed ?? []), uid].slice(-MAX_ALLOWED);
    await this.store.save(t);
    return "ok";
  }

  async message(uid: number, raw: string) {
    const t = await this.get();
    if (!t || raw.length > MAX_MESSAGE) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const msg = tableMessage.safeParse(parsed);
    if (!msg.success) return this.tell(uid, { t: "error", error: "that didn't make sense" });
    const m = msg.data;
    const seated = (id: number) => t.players.some((p) => p.id === id);
    if (!seated(uid)) return;
    if (m.t === "signal") {
      // Only between two people at this table, and only from who it says it's from.
      if (!seated(m.to) || m.to === uid) return;
      return this.tell(m.to, { t: "signal", from: uid, data: m.data });
    }
    if (m.t === "lock") {
      if (t.host !== uid) return this.tell(uid, { t: "error", error: "only the host sets a password" });
      if (m.password === null) t.lock = null;
      else {
        const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));
        t.lock = { salt, hash: await passwordHash(m.password, salt) };
      }
      // Everyone sitting now stays; a new password starts a new list of who gave it.
      t.allowed = [];
      t.updatedAt = this.clock();
      return this.commit();
    }
    if (m.t === "chat" && this.flooding(uid)) return this.tell(uid, { t: "error", error: "slow down a little" });
    const r = command(t, uid, m, this.clock(), this.rand);
    if ("error" in r) this.tell(uid, { t: "error", error: r.error });
    else await this.commit();
    if (m.t === "leave") for (const c of this.store.conns()) if (c.uid === uid) c.close?.(1000, "left the table");
  }

  /** A browser went away; the player is away once all their browsers are. */
  async closed(uid: number, remaining: Conn[]) {
    const t = await this.get();
    if (!t) return;
    if (remaining.some((c) => c.uid === uid)) return;
    const p = t.players.find((x) => x.id === uid);
    if (!p?.connected) return;
    p.connected = false;
    t.updatedAt = this.clock();
    await this.commit(remaining);
  }

  /** The clock: a phase is over, or it is time to see whether the table is still in use. */
  async alarm() {
    const t = await this.get();
    if (!t) return;
    const now = this.clock();
    if (t.deadline !== null && now >= t.deadline) {
      tick(t, now, this.rand);
      return this.commit();
    }
    const anyone = this.store.conns().length > 0;
    if ((!anyone && now - t.updatedAt >= EMPTY_MS) || now - t.updatedAt >= STALE_MS) return this.putAway();
    await this.store.schedule(t.deadline ?? now + EMPTY_MS);
  }

  private async putAway() {
    const code = this.table?.code;
    for (const c of this.store.conns()) c.close?.(4000, "the table was put away");
    this.table = null;
    await this.store.save(null);
    if (code) await this.store.list(code, null);
  }

  private flooding(uid: number): boolean {
    const now = this.clock();
    const recent = (this.chatter.get(uid) ?? []).filter((at) => now - at < 10_000);
    recent.push(now);
    this.chatter.set(uid, recent);
    return recent.length > 8;
  }

  private tell(uid: number, event: TableEvent) {
    const data = JSON.stringify(event);
    for (const c of this.store.conns()) if (c.uid === uid) safeSend(c, data);
  }

  /** Saves the table, sends everyone their view, sets the next wake-up and updates the list of open tables. */
  private async commit(conns = this.store.conns()) {
    const t = this.table;
    if (!t) return;
    const now = this.clock();
    if (t.players.length === 0) return this.putAway();
    await this.store.save(t);
    const views = new Map<number, string>();
    for (const c of conns) {
      let data = views.get(c.uid);
      if (!data) {
        data = JSON.stringify({ t: "view", view: viewFor(t, c.uid, now) } satisfies TableEvent);
        views.set(c.uid, data);
      }
      safeSend(c, data);
    }
    await this.store.schedule(t.deadline ?? now + EMPTY_MS);
    const listing = t.settings.listed ? listingOf(t) : null;
    const key = JSON.stringify(listing && { ...listing, updatedAt: 0 });
    if (key !== this.listed) {
      this.listed = key;
      await this.store.list(t.code, listing);
    }
  }
}

function safeSend(c: Conn, data: string) {
  try {
    c.send(data);
  } catch {
    // closing; its close handler tidies up
  }
}

/* ---------- development and tests: every table in this process ---------- */

type Held = { room: TableRoom; table: Table | null; conns: Set<Conn>; timer: ReturnType<typeof setTimeout> | null };

export class MemoryTables {
  private tables = new Map<string, Held>();
  private listings = new Map<string, TableListing>();

  private held(code: string): Held {
    let h = this.tables.get(code);
    if (h) return h;
    const fresh: Held = { table: null, conns: new Set(), timer: null, room: null as unknown as TableRoom };
    fresh.room = new TableRoom({
      conns: () => [...fresh.conns],
      load: async () => fresh.table,
      save: async (t) => {
        fresh.table = t ? structuredClone(t) : null;
        if (!t) {
          if (fresh.timer) clearTimeout(fresh.timer);
          this.tables.delete(code);
        }
      },
      schedule: async (at) => {
        if (fresh.timer) clearTimeout(fresh.timer);
        fresh.timer = setTimeout(() => void fresh.room.alarm(), Math.max(0, at - Date.now()));
        fresh.timer.unref?.();
      },
      list: async (_code, l) => {
        if (l) this.listings.set(code, l);
        else this.listings.delete(code);
      },
    });
    h = fresh;
    this.tables.set(code, h);
    return h;
  }

  async create(code: string, host: Seat) {
    return this.held(code).room.create(code, host);
  }

  async list(): Promise<TableListing[]> {
    return [...this.listings.values()];
  }

  async unlock(code: string, uid: number, password: string): Promise<Unlock> {
    const h = this.tables.get(code);
    return h?.table ? h.room.unlock(uid, password) : "gone";
  }

  has(code: string) {
    return Boolean(this.tables.get(code)?.table);
  }

  /** A browser's socket joins a table. */
  async attach(code: string, seat: Seat, conn: Conn) {
    const h = this.tables.get(code);
    if (!h?.table) {
      conn.send(JSON.stringify({ t: "closed", reason: "this table has been put away" } satisfies TableEvent));
      conn.close?.(4004, "no such table");
      return null;
    }
    h.conns.add(conn);
    const err = await h.room.join(seat);
    if (err) {
      h.conns.delete(conn);
      conn.send(JSON.stringify({ t: "closed", reason: err.error } satisfies TableEvent));
      conn.close?.(4003, err.error);
      return null;
    }
    return {
      message: (raw: string) => h.room.message(seat.id, raw),
      close: () => {
        h.conns.delete(conn);
        return h.room.closed(seat.id, [...h.conns]);
      },
    };
  }
}
