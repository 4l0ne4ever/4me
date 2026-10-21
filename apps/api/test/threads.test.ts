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
import { seedIfEmpty } from "../src/seed";

void signTicket;
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
const guest = (method: string, path: string, body?: unknown, ip?: string) =>
  send(method, path, body, { internal: false, ip });

let lamps: { id: number; authorId: number };
let mai: { id: number };
let khoa: { id: number };

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
  mai = (await (
    await send("POST", "/internal/users", { email: "m@x.co", displayName: "Mai", passwordHash: HASH })
  ).json()) as typeof mai;
  khoa = (await (
    await send("POST", "/internal/users", { email: "k@x.co", displayName: "Khoa", passwordHash: HASH })
  ).json()) as typeof khoa;
});
beforeEach(() => {
  sent.length = 0;
});

describe("replies", () => {
  it("threads a reply under its note, and a reply to a reply under the same note", async () => {
    const root = (await (
      await send("POST", `/internal/users/${mai.id}/notes/${lamps.id}`, { body: "first" })
    ).json()) as {
      note: { id: number };
    };
    const reply = (await (
      await send("POST", `/internal/users/${khoa.id}/notes/${lamps.id}`, { body: "answer", parentId: root.note.id })
    ).json()) as { note: { id: number; parentId: number } };
    expect(reply.note.parentId).toBe(root.note.id);
    const deeper = (await (
      await guest("POST", `/entries/${lamps.id}/notes`, { name: "moth", body: "me too", parentId: reply.note.id })
    ).json()) as { note: { parentId: number } };
    expect(deeper.note.parentId).toBe(root.note.id);
    // Whoever was replied to hears about it: Mai about Khoa's reply, Khoa about moth's.
    const replies = async (uid: number) =>
      (
        (await (await call(`/internal/users/${uid}/notifications`)).json()) as {
          items: Array<{ kind: string; text: string }>;
        }
      ).items
        .filter((i) => i.kind === "reply")
        .map((i) => i.text);
    expect(await replies(mai.id)).toEqual(["Khoa replied to your note on “The lamps came on before I got home”"]);
    expect(await replies(khoa.id)).toEqual(["moth replied to your note on “The lamps came on before I got home”"]);
  });

  it("refuses a reply to a note on another page", async () => {
    const [tram] = await db
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(eq(schema.entries.slug, "the-last-tram"));
    const [onLamps] = await db
      .select({ id: schema.notes.id })
      .from(schema.notes)
      .where(eq(schema.notes.entryId, lamps.id))
      .limit(1);
    const res = await guest("POST", `/entries/${tram!.id}/notes`, { body: "x", parentId: onLamps!.id });
    expect(res.status).toBe(404);
  });
});

describe("the front desktop's Messenger", () => {
  it("lists the newest notes from every page, with the page each was left on, and hears new ones live", async () => {
    await guest("POST", `/entries/${lamps.id}/notes`, { name: "owl", body: "the front page hears this" });
    expect(sent.some((s) => s.topics.includes("notes") && s.event.type === "note")).toBe(true);
    const recent = (await (await call("/entries/notes/recent", { internal: false })).json()) as Array<{
      body: string;
      page: { slug: string; handle: string };
    }>;
    const last = recent.at(-1)!;
    expect(last.body).toBe("the front page hears this");
    expect(last.page).toMatchObject({ slug: "the-lamps-came-on-early", handle: "4me" });
  });
});

describe("reactions", () => {
  it("counts one reaction per reader, lets them change or take it back, and tells the page", async () => {
    await guest("POST", `/entries/${lamps.id}/react`, { kind: "love" }, "10.7.0.1");
    await guest("POST", `/entries/${lamps.id}/react`, { kind: "love" }, "10.7.0.2");
    await guest("POST", `/entries/${lamps.id}/react`, { kind: "sad" }, "10.7.0.1"); // changed their mind
    await send("POST", `/internal/users/${mai.id}/react`, { target: "entry", targetId: lamps.id, kind: "moon" });
    const res = await guest("GET", "/entries/by/4me/the-lamps-came-on-early");
    expect(((await res.json()) as { reactions: unknown }).reactions).toEqual({ love: 1, sad: 1, moon: 1 });
    expect(of("reactions").at(-1)).toMatchObject({
      topics: [`entry:${lamps.id}`],
      event: { target: "entry", targetId: lamps.id, reactions: { love: 1, sad: 1, moon: 1 } },
    });
    expect(await (await guest("GET", `/entries/${lamps.id}/reactions/mine`, undefined, "10.7.0.1")).json()).toEqual({
      entry: "sad",
      notes: {},
    });
    await guest("POST", `/entries/${lamps.id}/react`, { kind: null }, "10.7.0.1");
    const after = (await (await guest("GET", "/entries/by/4me/the-lamps-came-on-early")).json()) as {
      reactions: unknown;
    };
    expect(after.reactions).toEqual({ love: 1, moon: 1 });
  });

  it("reacts to notes, tells the note's member once, and shows counts with the notes", async () => {
    const root = (await (
      await send("POST", `/internal/users/${mai.id}/notes/${lamps.id}`, { body: "react to me" })
    ).json()) as {
      note: { id: number };
    };
    sent.length = 0;
    await send("POST", `/internal/users/${khoa.id}/react`, { target: "note", targetId: root.note.id, kind: "hug" });
    await guest("POST", `/entries/notes/${root.note.id}/react`, { kind: "hug" });
    expect(of("notify").filter((s) => s.topics[0] === `user:${mai.id}`)).toHaveLength(1);
    const notes = (await (await guest("GET", `/entries/${lamps.id}/notes`)).json()) as Array<{
      id: number;
      reactions: unknown;
    }>;
    expect(notes.find((x) => x.id === root.note.id)?.reactions).toEqual({ hug: 2 });
    const khoasView = (await (await call(`/internal/users/${khoa.id}/reactions?entry=${lamps.id}`)).json()) as {
      notes: Record<string, string>;
    };
    expect(khoasView.notes[root.note.id]).toBe("hug");
  });

  it("rejects unknown reactions and unreadable pages", async () => {
    expect((await guest("POST", `/entries/${lamps.id}/react`, { kind: "angry" })).status).toBe(400);
    expect((await guest("POST", "/entries/999999/react", { kind: "love" })).status).toBe(404);
  });
});

describe("deleting notes", () => {
  it("lets the note's writer or the page's writer delete it, with its replies, and nobody else", async () => {
    const root = (await (
      await send("POST", `/internal/users/${mai.id}/notes/${lamps.id}`, { body: "delete me" })
    ).json()) as {
      note: { id: number };
    };
    await send("POST", `/internal/users/${khoa.id}/notes/${lamps.id}`, { body: "a reply", parentId: root.note.id });
    expect((await send("DELETE", `/internal/users/${khoa.id}/notes/${root.note.id}`)).status).toBe(404);
    expect((await send("DELETE", `/internal/users/${lamps.authorId}/notes/${root.note.id}`)).status).toBe(200);
    const left = await db.select().from(schema.notes).where(eq(schema.notes.parentId, root.note.id));
    expect(left).toHaveLength(0);
    expect(of("note-gone")[0]).toMatchObject({ event: { noteId: root.note.id } });
  });
});
