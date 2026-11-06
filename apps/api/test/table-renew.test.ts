import { readTicket, signTicket, type TableEvent } from "@4me/shared";
import { describe, expect, it } from "vitest";
import { type Conn, SIGN_IN_AGAIN, SIGNED_IN_MS, TableRoom, type TableStore } from "../src/live/table";

// A socket at a table lives only as long as its player is still signed in: a fresh ticket keeps it, a bad one or
// none at all lets it go once the last good one runs out.

const SECRET = "test-secret-0123456789";
const seat = (id: number) => ({ id, name: `P${id}`, handle: `p${id}`, avatar: "a" });

function room() {
  let now = 1_000_000;
  const conns: Array<Conn & { got: TableEvent[]; closedWith: number | null }> = [];
  const store: TableStore = {
    conns: () => conns.filter((c) => c.closedWith === null),
    load: async () => null,
    save: async () => {},
    schedule: async () => {},
    list: async () => {},
    renew: (uid, until) => {
      for (const c of conns) if (c.uid === uid) c.until = until;
    },
  };
  const r = new TableRoom(
    store,
    () => 0.5,
    () => now,
    (ticket) => readTicket("live", ticket, SECRET, now),
  );
  const connect = async (id: number) => {
    const c = {
      uid: id,
      until: undefined as number | undefined,
      got: [] as TableEvent[],
      closedWith: null as number | null,
      send(d: string) {
        this.got.push(JSON.parse(d) as TableEvent);
      },
      close(code: number) {
        this.closedWith = code;
      },
    };
    conns.push(c);
    expect(await r.join(seat(id))).toBeNull();
    return c;
  };
  return { r, connect, at: (ms: number) => (now = ms), now: () => now };
}

describe("a table's sockets and sign-in", () => {
  it("keeps a socket that shows fresh tickets, and lets one go that doesn't", async () => {
    const { r, connect, at, now } = room();
    expect(await r.create("renew1", seat(1))).toBe(true);
    const a = await connect(1);
    const b = await connect(2);
    expect(a.until).toBe(now() + SIGNED_IN_MS);

    // ten minutes on: 1 shows a fresh ticket; 2 shows someone else's, which doesn't count
    at(now() + 10 * 60_000);
    await r.message(1, JSON.stringify({ t: "renew", ticket: await signTicket("live", 1, SECRET, now()) }));
    await r.message(2, JSON.stringify({ t: "renew", ticket: await signTicket("live", 1, SECRET, now()) }));
    expect(a.until).toBe(now() + SIGNED_IN_MS);

    // past 2's fifteen minutes: the next thing that happens at the table lets 2 go, and tells them why
    at(now() + 6 * 60_000);
    await r.alarm();
    expect(b.closedWith).toBe(4001);
    expect(b.got.at(-1)).toEqual({ t: "closed", reason: SIGN_IN_AGAIN });
    expect(a.closedWith).toBeNull();
  });

  it("doesn't take an expired ticket, or one signed with another secret", async () => {
    const { r, connect, at, now } = room();
    await r.create("renew2", seat(1));
    const a = await connect(1);
    const before = a.until;
    const old = await signTicket("live", 1, SECRET, now() - 20 * 60_000);
    await r.message(1, JSON.stringify({ t: "renew", ticket: old }));
    await r.message(
      1,
      JSON.stringify({ t: "renew", ticket: await signTicket("live", 1, "another-secret-xyz", now()) }),
    );
    expect(a.until).toBe(before);
    at(now() + SIGNED_IN_MS + 1);
    await r.message(1, JSON.stringify({ t: "chat", body: "still here?" }));
    expect(a.closedWith).toBe(4001);
  });
});
