import { type LiveEvent, signTicket } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings, Live } from "../src/env";
import { MemoryHub, type Socket } from "../src/live/memory";
import { vetTopics } from "../src/live/vet";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

/** Remembers every broadcast instead of sending it. */
const sent: Array<{ topics: string[]; event: LiveEvent }> = [];
const recorder: Live = { publish: (topics, event) => void sent.push({ topics, event }) };
const of = (type: LiveEvent["type"]) => sent.filter((s) => s.event.type === type);

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;

function call(path: string, init: RequestInit & { internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `203.0.113.${++n % 250}`);
  if (init.internal !== false) {
    headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
    headers.set("x-client-ip", `198.51.100.${n % 250}`);
  }
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown, internal = true) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), internal });

let lamps: { id: number; authorId: number };
let lan: { id: number };
let reader: { id: number; displayName: string };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
    () => recorder,
  );
  [lamps] = (await db
    .select({ id: schema.entries.id, authorId: schema.entries.authorId })
    .from(schema.entries)
    .where(eq(schema.entries.slug, "the-lamps-came-on-early"))) as [typeof lamps];
  [lan] = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.handle, "lan"))) as [
    typeof lan,
  ];
  reader = (await (
    await send("POST", "/internal/users", { email: "reader@example.com", displayName: "Reader", passwordHash: HASH })
  ).json()) as typeof reader;
});

beforeEach(() => {
  sent.length = 0;
});

describe("which topics a browser may listen to", () => {
  const url = (q: string) => new URL(`https://api.example/live?${q}`);

  it("allows public pages, guestbooks and tonight", async () => {
    expect(await vetTopics(url("t=entry:12&t=guest:lan&t=guest:_&t=tonight"), "s")).toEqual([
      "entry:12",
      "guest:lan",
      "guest:_",
      "tonight",
    ]);
  });

  it("adds a member's own notifications only with a ticket signed for them", async () => {
    const ticket = await signTicket("live", 7, "s");
    expect(await vetTopics(url(`t=tonight&ticket=${ticket}`), "s")).toEqual(["tonight", "user:7"]);
    expect(await vetTopics(url(`ticket=${ticket}`), "other")).toBeNull();
    const upload = await signTicket("upload", 7, "s");
    expect(await vetTopics(url(`ticket=${upload}`), "s")).toBeNull();
  });

  it("refuses anything else", async () => {
    expect(await vetTopics(url("t=user:7"), "s")).toBeNull();
    expect(await vetTopics(url("t=entry:abc"), "s")).toBeNull();
    expect(await vetTopics(url("t=guest:Admin!"), "s")).toBeNull();
    expect(await vetTopics(url(Array.from({ length: 7 }, (_, i) => `t=entry:${i}`).join("&")), "s")).toBeNull();
    expect(await vetTopics(url(""), "s")).toBeNull();
  });
});

describe("the in-process hub", () => {
  const socket = () => {
    const got: LiveEvent[] = [];
    const s: Socket & { got: LiveEvent[] } = { readyState: 1, send: (d) => got.push(JSON.parse(d)), got };
    return s;
  };

  it("sends each event only to sockets on its topics, and counts who is reading a page", () => {
    const hub = new MemoryHub();
    const a = socket();
    const b = socket();
    hub.add(a, ["entry:1", "tonight"]);
    hub.add(b, ["entry:1"]);
    const presence = () => a.got.filter((e) => e.type === "presence").at(-1);
    expect(presence()).toEqual({ type: "presence", entryId: 1, reading: 2 });
    hub.publish(["tonight"], { type: "hello" });
    expect(a.got.filter((e) => e.type === "hello")).toHaveLength(2);
    expect(b.got.filter((e) => e.type === "hello")).toHaveLength(1);
    hub.remove(b);
    expect(presence()).toEqual({ type: "presence", entryId: 1, reading: 1 });
  });
});

describe("live updates and notifications", () => {
  it("shows a guest's note to everyone on the page and tells the writer", async () => {
    await send("POST", `/entries/${lamps.id}/notes`, { name: "moth", body: "still here" }, false);
    expect(of("note")[0]).toMatchObject({ topics: [`entry:${lamps.id}`, "notes"], event: { note: { name: "moth" } } });
    expect(of("notify")[0]).toMatchObject({
      topics: [`user:${lamps.authorId}`],
      event: { notification: { kind: "note", text: "moth left a note on “The lamps came on before I got home”" } },
    });
  });

  it("keeps a held note off the page but tells the writer it is waiting", async () => {
    await send("POST", `/entries/${lamps.id}/notes`, { name: "spam", body: "http://x.example" }, false);
    expect(of("note")).toHaveLength(0);
    expect(of("notify")[0]?.event).toMatchObject({ notification: { kind: "pending" } });
  });

  it("shakes everyone on the page on a BUZZ, and notifies once until it is read", async () => {
    await send("POST", `/entries/${lamps.id}/buzz`, undefined, false);
    await send("POST", `/entries/${lamps.id}/buzz`, undefined, false);
    expect(of("buzz")).toHaveLength(2);
    expect(of("notify")).toHaveLength(1);
  });

  it("puts a shout in the right guestbook and tells its owner", async () => {
    await send("POST", "/guestbook", { name: "moth", body: "hi lan", owner: "lan" }, false);
    expect(of("shout")[0]).toMatchObject({ topics: ["guest:lan"], event: { owner: "lan" } });
    expect(of("notify")[0]).toMatchObject({ topics: [`user:${lan.id}`] });
  });

  it("announces a new public page on Tonight, but not a private one", async () => {
    await send("POST", `/internal/users/${reader.id}/entries`, { title: "first", body: "x" });
    await send("POST", `/internal/users/${reader.id}/entries`, { title: "secret", body: "x", visibility: "private" });
    expect(of("entry")).toHaveLength(1);
    expect(of("entry")[0]).toMatchObject({ topics: ["tonight"], event: { entry: { title: "first" } } });
  });

  it("tells members who left a note when the writer replies", async () => {
    const list = (await (await call(`/internal/users/${reader.id}/entries`)).json()) as Array<{
      id: number;
      title: string;
    }>;
    const mine = list.find((e) => e.title === "first");
    await send("POST", `/internal/users/${lan.id}/notes/${mine!.id}`, { body: "lovely" });
    sent.length = 0;
    await send("POST", `/internal/users/${reader.id}/notes/${mine!.id}`, { body: "thank you" });
    expect(of("notify")).toHaveLength(1);
    expect(of("notify")[0]).toMatchObject({
      topics: [`user:${lan.id}`],
      event: { notification: { kind: "reply", text: "Reader replied on “first”" } },
    });
  });

  it("keeps notifications for later and marks them read", async () => {
    const before = (await (await call(`/internal/users/${lamps.authorId}/notifications`)).json()) as {
      items: Array<{ id: number; read: boolean }>;
      unread: number;
    };
    expect(before.unread).toBeGreaterThanOrEqual(3);
    await send("POST", `/internal/users/${lamps.authorId}/notifications/read`, { ids: [before.items[0]!.id] });
    const one = (await (await call(`/internal/users/${lamps.authorId}/notifications`)).json()) as { unread: number };
    expect(one.unread).toBe(before.unread - 1);
    await send("POST", `/internal/users/${lamps.authorId}/notifications/read`, {});
    const none = (await (await call(`/internal/users/${lamps.authorId}/notifications`)).json()) as { unread: number };
    expect(none.unread).toBe(0);
  });
});

describe("the live door", () => {
  const open = (q: string, headers: Record<string, string>) =>
    app.request(`/live?${q}`, { headers: { "cf-connecting-ip": "203.0.113.77", ...headers } }, env);

  it("wants a WebSocket from the diary's own site, with something to listen to", async () => {
    expect((await open("t=tonight", { origin: "https://4me.example" })).status).toBe(426);
    const ws = { upgrade: "websocket" };
    expect((await open("t=tonight", { ...ws, origin: "https://evil.example" })).status).toBe(403);
    expect((await open("t=user:1", { ...ws, origin: "https://4me.example" })).status).toBe(400);
    // The recorder can't hold connections: the request got all the way to the hand-off.
    expect((await open("t=tonight", { ...ws, origin: "https://4me.example" })).status).toBe(501);
  });
});
