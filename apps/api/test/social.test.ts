import type { LiveEvent } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings, Live } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const sent: Array<{ topics: string[]; event: LiveEvent }> = [];
const recorder: Live = { publish: (topics, event) => void sent.push({ topics, event }) };
const of = (type: LiveEvent["type"]) => sent.filter((s) => s.event.type === type);

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;
function call(path: string, init: RequestInit & { internal?: boolean; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `203.0.113.${++n % 250}`);
  if (init.internal !== false) {
    headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
    headers.set("x-client-ip", init.ip ?? `198.51.100.${n % 250}`);
  }
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown, extra: { internal?: boolean; ip?: string } = {}) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), ...extra });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

let mai: { id: number; handle: string };
let khoa: { id: number; handle: string };
let lampsId: number;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
    () => recorder,
  );
  mai = await json(send("POST", "/internal/users", { email: "m@x.co", displayName: "Mai Trần", passwordHash: HASH }));
  khoa = await json(send("POST", "/internal/users", { email: "k@x.co", displayName: "Khoa", passwordHash: HASH }));
  [{ id: lampsId }] = (await db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(eq(schema.entries.slug, "the-lamps-came-on-early"))) as [{ id: number }];
});
beforeEach(() => {
  sent.length = 0;
});

describe("subscriptions", () => {
  it("subscribes to a diary quietly, and lists the diaries subscribed to", async () => {
    expect((await send("POST", `/internal/users/${mai.id}/subscriptions/lan`)).status).toBe(200);
    await send("POST", `/internal/users/${mai.id}/subscriptions/lan`); // twice is still once
    // A blog, not a social network: nobody is told who subscribed.
    expect(of("notify")).toHaveLength(0);
    const list = await json<Array<{ handle: string; lastWroteAt: string | null }>>(
      call(`/internal/users/${mai.id}/subscriptions`),
    );
    expect(list).toEqual([expect.objectContaining({ handle: "lan", lastWroteAt: expect.any(String) })]);
    expect((await json<{ subscribers: number }>(call("/profiles/lan", { internal: false }))).subscribers).toBe(1);
    expect((await send("POST", `/internal/users/${mai.id}/subscriptions/${mai.handle}`)).status).toBe(400);
  });

  it("tells subscribers about a new public page, not a draft", async () => {
    await send("POST", `/internal/users/${khoa.id}/subscriptions/${mai.handle}`);
    sent.length = 0;
    await send("POST", `/internal/users/${mai.id}/entries`, { title: "hello readers", body: "x" });
    await send("POST", `/internal/users/${mai.id}/entries`, { title: "not for you", body: "x", visibility: "draft" });
    const told = of("notify").filter((s) => s.topics[0] === `user:${khoa.id}`);
    expect(told).toHaveLength(1);
    expect(told[0]?.event).toMatchObject({
      notification: { kind: "post", text: "Mai Trần wrote a new page: “hello readers”" },
    });
  });

  it("shows only subscribed diaries' public pages on the reading list, newest first", async () => {
    await send("POST", `/internal/users/${khoa.id}/entries`, { title: "khoa public", body: "x" });
    await send("POST", `/internal/users/${khoa.id}/entries`, {
      title: "khoa secret",
      body: "x",
      visibility: "private",
    });
    await send("POST", `/internal/users/${mai.id}/subscriptions/${khoa.handle}`);
    const feed = await json<Array<{ title: string; author: { handle: string } }>>(
      call(`/internal/users/${mai.id}/feed`),
    );
    expect(feed.map((e) => e.title)).toEqual(["khoa public", "The last tram"]);
    await send("DELETE", `/internal/users/${mai.id}/subscriptions/${khoa.handle}`);
    const after = await json<Array<{ title: string }>>(call(`/internal/users/${mai.id}/feed`));
    expect(after.map((e) => e.title)).toEqual(["The last tram"]);
  });
});

describe("search", () => {
  const search = (q: string) =>
    json<{ people: Array<{ handle: string }>; pages: Array<{ title: string }> }>(
      call(`/search?q=${encodeURIComponent(q)}`, { internal: false }),
    );

  it("finds pages by words in the title or text", async () => {
    expect((await search("bus stop")).pages.map((p) => p.title)).toContain("The lamps came on before I got home");
    expect((await search("zzzz-nothing")).pages).toEqual([]);
  });

  it("finds Vietnamese with or without accents, and never private pages", async () => {
    await send("POST", `/internal/users/${khoa.id}/entries`, { title: "Mưa đầu mùa", body: "đêm nay" });
    await send("POST", `/internal/users/${khoa.id}/entries`, {
      title: "Mưa riêng tư",
      body: "x",
      visibility: "private",
    });
    expect((await search("mua dau")).pages.map((p) => p.title)).toEqual(["Mưa đầu mùa"]);
    expect((await search("Mưa")).pages.map((p) => p.title)).toEqual(["Mưa đầu mùa"]);
  });

  it("finds people by name or address", async () => {
    expect((await search("tran")).people.map((p) => p.handle)).toEqual([mai.handle]);
    expect((await search("lan")).people.map((p) => p.handle)).toContain("lan");
    expect(await search("%")).toEqual({ people: [], pages: [] });
  });
});

describe("editing and reporting notes", () => {
  let noteId: number;

  it("lets only the note's writer edit it, and updates everyone reading", async () => {
    noteId = (
      await json<{ note: { id: number } }>(send("POST", `/internal/users/${mai.id}/notes/${lampsId}`, { body: "typo" }))
    ).note.id;
    sent.length = 0;
    expect((await send("PATCH", `/internal/users/${khoa.id}/notes/${noteId}`, { body: "hijack" })).status).toBe(404);
    const res = await json<{ note: { body: string; editedAt: string | null } }>(
      send("PATCH", `/internal/users/${mai.id}/notes/${noteId}`, { body: "fixed" }),
    );
    expect(res.note).toMatchObject({ body: "fixed", editedAt: expect.any(String) });
    expect(of("note")[0]).toMatchObject({
      topics: [`entry:${lampsId}`],
      event: { note: { id: noteId, body: "fixed" } },
    });
  });

  it("sends an edit that adds a link back for approval", async () => {
    const res = await json<{ pending: boolean }>(
      send("PATCH", `/internal/users/${mai.id}/notes/${noteId}`, { body: "see http://x.example" }),
    );
    expect(res.pending).toBe(true);
    expect(of("note-gone")[0]?.event).toMatchObject({ noteId });
  });

  it("hides a note three different readers report, until the moderator shows it again", async () => {
    const id = (
      await json<{ note: { id: number } }>(send("POST", `/internal/users/${khoa.id}/notes/${lampsId}`, { body: "meh" }))
    ).note.id;
    expect((await send("POST", `/internal/users/${khoa.id}/reports/notes/${id}`, { reason: "spam" })).status).toBe(400);
    await send("POST", `/internal/users/${mai.id}/reports/notes/${id}`, { reason: "hurtful" });
    await send("POST", `/entries/notes/${id}/report`, { reason: "spam" }, { internal: false, ip: "10.8.0.1" });
    const visible = async () =>
      (await json<Array<{ id: number }>>(call(`/entries/${lampsId}/notes`, { internal: false }))).some(
        (x) => x.id === id,
      );
    expect(await visible()).toBe(true);
    await send("POST", `/entries/notes/${id}/report`, { reason: "spam" }, { internal: false, ip: "10.8.0.2" });
    expect(await visible()).toBe(false);
    expect(of("note-gone").at(-1)?.event).toMatchObject({ noteId: id });
    const queue = await json<Array<{ id: number; count: number }>>(call("/admin/note-reports"));
    expect(queue[0]).toMatchObject({ id, count: 3 });
    await send("PATCH", `/admin/notes/${id}`, { status: "visible" });
    expect(await visible()).toBe(true);
    expect(await json<unknown[]>(call("/admin/note-reports"))).toHaveLength(0);
  });
});
