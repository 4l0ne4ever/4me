import type { EntrySummary, Note, Shout } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
let app: ReturnType<typeof createApp>;
let n = 0;

function call(path: string, init: RequestInit & { ip?: string; internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `192.0.2.${++n % 250}`);
  if (init.internal !== false) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const post = (path: string, body: unknown, extra: { ip?: string; internal?: boolean } = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), ...extra });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

type Who = { id: number; handle: string };
let writer: Who;
let reader: Who;
let page: number;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(() => db);
  writer = await json<Who>(post("/internal/users", { email: "w@x.co", displayName: "Willow", passwordHash: HASH }));
  reader = await json<Who>(post("/internal/users", { email: "r@x.co", displayName: "Rook", passwordHash: HASH }));
  page = (
    await json<{ id: number }>(post(`/internal/users/${writer.id}/entries`, { title: "Moths", body: "at the lamp" }))
  ).id;
});

describe("keeping someone off your diary", () => {
  it("keeps a guest off by the address their note came from, and nobody else", async () => {
    const res = await post(
      `/entries/${page}/notes`,
      { name: "pest", body: "first!" },
      { ip: "203.0.113.7", internal: false },
    );
    const { note } = (await res.json()) as { note: Note };
    const ban = await post(`/internal/users/${writer.id}/bans`, { noteId: note.id, remove: true });
    expect(ban.status).toBe(201);
    const again = await post(
      `/entries/${page}/notes`,
      { name: "pest", body: "again" },
      { ip: "203.0.113.7", internal: false },
    );
    expect(again.status).toBe(403);
    const other = await post(
      `/entries/${page}/notes`,
      { name: "moth", body: "hello" },
      { ip: "203.0.113.8", internal: false },
    );
    expect(other.status).toBe(201);
    // removed along with the ban
    const left = await json<Note[]>(call(`/entries/${page}/notes`, { internal: false }));
    expect(left.map((x) => x.body)).toEqual(["hello"]);
  });

  it("keeps a member off: no notes, no signing the guestbook, until they're let back", async () => {
    const { note } = await json<{ note: Note }>(post(`/internal/users/${reader.id}/notes/${page}`, { body: "hm" }));
    await post(`/internal/users/${writer.id}/bans`, { noteId: note.id });
    expect((await post(`/internal/users/${reader.id}/notes/${page}`, { body: "hm?" })).status).toBe(403);
    expect((await post(`/internal/users/${reader.id}/shouts`, { body: "hi", owner: writer.handle })).status).toBe(403);
    const list = await json<Array<{ id: number; label: string; kind: string }>>(
      call(`/internal/users/${writer.id}/bans`),
    );
    const rook = list.find((b) => b.label === "Rook");
    expect(rook).toMatchObject({ kind: "member" });
    expect(list.find((b) => b.label === "pest")).toMatchObject({ kind: "guest" });
    await call(`/internal/users/${writer.id}/bans/${rook!.id}`, { method: "DELETE" });
    expect((await post(`/internal/users/${reader.id}/notes/${page}`, { body: "thank you" })).status).toBe(201);
  });

  it("works from the guestbook too, and lets the owner take a shout down", async () => {
    const { shout } = await json<{ shout: Shout }>(
      post(
        "/guestbook",
        { name: "spam", body: "buy now", owner: writer.handle },
        { ip: "203.0.113.9", internal: false },
      ),
    );
    await post(`/internal/users/${writer.id}/bans`, { shoutId: shout.id });
    const again = await post(
      "/guestbook",
      { name: "spam", body: "buy", owner: writer.handle },
      { ip: "203.0.113.9", internal: false },
    );
    expect(again.status).toBe(403);
    expect((await call(`/internal/users/${writer.id}/shouts/${shout.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("only from your own diary, and never yourself", async () => {
    const { note } = await json<{ note: Note }>(post(`/internal/users/${writer.id}/notes/${page}`, { body: "mine" }));
    expect((await post(`/internal/users/${writer.id}/bans`, { noteId: note.id })).status).toBe(400);
    expect((await post(`/internal/users/${reader.id}/bans`, { noteId: note.id })).status).toBe(404);
  });
});

describe("the week's favourites", () => {
  it("ranks this week's pages by notes, reactions and reads, and leaves out older ones", async () => {
    const list = await json<EntrySummary[]>(call("/entries/favourites", { internal: false }));
    expect(list.length).toBeGreaterThan(0);
    const week = Date.now() - 7 * 86_400_000;
    for (const e of list) expect(new Date(e.writtenAt).getTime()).toBeGreaterThan(week);
    // "Moths" has notes from other readers now; a page nobody has answered or read isn't a favourite
    expect(list.map((e) => e.title)).toContain("Moths");
    await post(`/internal/users/${writer.id}/entries`, { title: "Unread", body: "nobody yet" });
    const after = await json<EntrySummary[]>(call("/entries/favourites?limit=10", { internal: false }));
    expect(after.map((e) => e.title)).not.toContain("Unread");
  });
});
