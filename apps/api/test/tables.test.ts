import type { TableEvent, TableListing, TableView } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { type Conn, MemoryTables } from "../src/live/table";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
type Who = { id: number; handle: string };

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;
const tables = new MemoryTables();
const people: Who[] = [];

function call(path: string, init: RequestInit & { internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++n % 250}`);
  if (init.internal !== false) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}

/** A browser at a table: what it has been sent, and a way to send. */
class Browser {
  events: TableEvent[] = [];
  closed: string | null = null;
  at: Awaited<ReturnType<MemoryTables["attach"]>> = null;
  constructor(readonly who: Who) {}
  conn(): Conn {
    return {
      uid: this.who.id,
      send: (d) => this.events.push(JSON.parse(d) as TableEvent),
      close: (_c, reason) => {
        this.closed = reason;
      },
    };
  }
  get view(): TableView {
    const views = this.events.filter((e): e is Extract<TableEvent, { t: "view" }> => e.t === "view");
    return views.at(-1)!.view;
  }
  async send(msg: unknown) {
    await this.at?.message(JSON.stringify(msg));
  }
}

async function sit(code: string, who: Who) {
  const b = new Browser(who);
  b.at = await tables.attach(code, { id: who.id, name: who.handle, handle: who.handle, avatar: "a" }, b.conn());
  return b;
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
    () => null,
    () => tables,
  );
  for (const name of ["Ann", "Bao", "Cuc", "Dung", "Em", "Phong"]) {
    const res = await call("/internal/users", {
      method: "POST",
      body: JSON.stringify({ email: `${name}@x.co`, displayName: name, passwordHash: HASH }),
    });
    people.push((await res.json()) as Who);
  }
});

describe("werewolf tables", () => {
  let code: string;

  it("a member opens a table; it is listed; others sit down", async () => {
    const res = await call(`/internal/users/${people[0]!.id}/tables`, { method: "POST" });
    expect(res.status).toBe(201);
    code = ((await res.json()) as { code: string }).code;
    expect(code).toMatch(/^[a-z0-9]{6}$/);
    const listed = (await (await call("/tables", { internal: false })).json()) as TableListing[];
    expect(listed.map((l) => l.code)).toContain(code);
    expect((await call(`/internal/users/${people[0]!.id}/tables`, { method: "POST", internal: false })).status).toBe(
      401,
    );
    const ice = (await (await call("/internal/tables/ice")).json()) as { iceServers: unknown[] };
    expect(ice.iceServers.length).toBeGreaterThan(0);
  });

  it("plays: everyone gets their own view, handshakes go only to who they're for", async () => {
    const browsers = [];
    for (const p of people) browsers.push(await sit(code, p));
    const [host, b2, b3] = browsers as [Browser, Browser, Browser];
    expect(host.view.players).toHaveLength(6);
    expect(host.view.me?.id).toBe(people[0]!.id);

    await b2.send({ t: "start" });
    expect(b2.events.at(-1)).toEqual({ t: "error", error: "only the host starts the game" });
    await host.send({ t: "start" });
    expect(host.view.phase).toBe("deal");
    for (const b of browsers) expect(b.view.players.filter((p) => p.role !== null).length).toBeGreaterThanOrEqual(1);
    const roles = browsers.map((b) => b.view.me!.role);
    expect(roles.filter((r) => r === "werewolf").length).toBe(1);
    // a villager sees only their own card
    const villager = browsers.find((b) => b.view.me!.role !== "werewolf")!;
    expect(villager.view.players.filter((p) => p.role !== null).map((p) => p.id)).toEqual([villager.who.id]);

    await host.send({ t: "signal", to: b3.who.id, data: { sdp: "offer" } });
    expect(b3.events.at(-1)).toEqual({ t: "signal", from: host.who.id, data: { sdp: "offer" } });
    expect(b2.events.some((e) => e.t === "signal")).toBe(false);
    // not to someone who isn't at the table
    await host.send({ t: "signal", to: 999999, data: {} });

    // a newcomer can't join a game under way
    const late = new Browser({ id: 424242, handle: "late" });
    expect(
      await tables.attach(code, { id: 424242, name: "late", handle: "late", avatar: "a" }, late.conn()),
    ).toBeNull();
    expect(late.closed).toBe("this game has already started");

    // going away keeps the seat; coming back gets the game as it is
    await b2.at?.close();
    expect(host.view.players.find((p) => p.id === b2.who.id)?.connected).toBe(false);
    const again = await sit(code, people[1]!);
    expect(again.view.phase).toBe("deal");
    expect(again.view.me?.role).toBe(roles[1]);
  });

  it("a table with a password: only who gives it sits down; the password never leaves the table", async () => {
    const [ann, bao, cuc, dung] = people as [Who, Who, Who, Who];
    const res = await call(`/internal/users/${ann.id}/tables`, { method: "POST" });
    const locked = ((await res.json()) as { code: string }).code;
    const host = await sit(locked, ann);
    const early = await sit(locked, bao);
    await early.send({ t: "lock", password: "moon" });
    expect(early.events.at(-1)).toEqual({ t: "error", error: "only the host sets a password" });
    await host.send({ t: "lock", password: "moonlight" });
    expect(host.view.locked).toBe(true);
    expect(JSON.stringify(host.events)).not.toContain("moonlight");
    const listed = (await (await call("/tables", { internal: false })).json()) as TableListing[];
    expect(listed.find((l) => l.code === locked)?.locked).toBe(true);
    // whoever was sitting stays, and can come back
    expect((await sit(locked, bao)).closed).toBeNull();
    // a newcomer is turned away until they give it
    const turned = await sit(locked, cuc);
    expect(turned.closed).toBe("this table has a password");
    const unlock = (who: Who, password: string) =>
      call(`/internal/users/${who.id}/tables/${locked}/unlock`, { method: "POST", body: JSON.stringify({ password }) });
    expect((await unlock(cuc, "sunlight")).status).toBe(403);
    expect((await unlock(cuc, "moonlight")).status).toBe(200);
    expect((await sit(locked, cuc)).closed).toBeNull();
    expect(host.view.players.map((p) => p.id)).toContain(cuc.id);
    // only the web server asks
    expect(
      (
        await call(`/internal/users/${dung.id}/tables/${locked}/unlock`, {
          method: "POST",
          body: JSON.stringify({ password: "moonlight" }),
          internal: false,
        })
      ).status,
    ).toBe(401);
    // a few tries, then wait
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await unlock(dung, `guess${i}`)).status;
    expect(last).toBe(429);
    // taking it off opens the table again
    await host.send({ t: "lock", password: null });
    expect(host.view.locked).toBe(false);
    expect((await sit(locked, dung)).closed).toBeNull();
  });

  it("the host sits computer players down, asks people to leave, and bans", async () => {
    const [ann, bao, cuc] = people as [Who, Who, Who];
    const res = await call(`/internal/users/${ann.id}/tables`, { method: "POST" });
    const room = ((await res.json()) as { code: string }).code;
    const host = await sit(room, ann);
    const b = await sit(room, bao);
    const c = await sit(room, cuc);
    await host.send({ t: "bot", add: true });
    await host.send({ t: "bot", add: true });
    expect(host.view.players.filter((p) => p.bot).map((p) => p.name)).toEqual(["Owl", "Moth"]);
    await b.send({ t: "bot", add: true });
    expect(b.events.at(-1)).toEqual({ t: "error", error: "only the host, before the game" });
    // asked to leave: told why, let go, and may come back
    await host.send({ t: "kick", id: bao.id });
    expect(b.closed).toBe("the host asked you to leave this table");
    expect((await sit(room, bao)).closed).toBeNull();
    // asked not to come back: may not
    await host.send({ t: "kick", id: cuc.id, ban: true });
    expect(c.closed).toBe("the host asked you not to come back to this table");
    expect((await sit(room, cuc)).closed).toBe("the host asked you not to come back to this table");
    expect(host.view.players.map((p) => p.name)).toEqual([ann.handle, "Owl", "Moth", bao.handle]);
  });
});
