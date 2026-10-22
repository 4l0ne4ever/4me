import { noteInput, reactInput, reportInput, toSticker } from "@4me/shared";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { entries, notes, users } from "../db/schema";
import type { AppEnv } from "../env";
import {
  authorCols,
  fileNoteReport,
  fileReport,
  isOpen,
  isReadable,
  noteCount,
  origin,
  positiveId,
  readableEntry,
  threadOf,
} from "../lib/entries";
import { allow, humanCheck, ipHash, looksLikeSpam } from "../lib/guard";
import { toEntry, toNote, toSummary } from "../lib/map";
import { anonymousNameProblem } from "../lib/names";
import { notify, publish, quote } from "../lib/notify";
import { countsFor, mine, react } from "../lib/reactions";
import { json } from "../lib/validate";

const cache = (seconds: number) => `public, max-age=${seconds}, s-maxage=${seconds * 2}, stale-while-revalidate=300`;

/** Readable pages, newest first, optionally one member's. */
function readable(c: Context<AppEnv>) {
  return c
    .get("db")
    .select({ e: entries, a: authorCols, noteCount })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.authorId));
}

const byAuthor = (handle: string | undefined) => (handle ? eq(users.handle, handle.toLowerCase()) : undefined);

export const entryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 50);
    const before = c.req.query("before");
    const beforeDate = before ? new Date(before) : null;
    const older = beforeDate && !Number.isNaN(beforeDate.getTime()) ? lt(entries.writtenAt, beforeDate) : undefined;
    const rows = await readable(c)
      .where(and(isReadable, byAuthor(c.req.query("author")), older))
      .orderBy(desc(entries.writtenAt))
      .limit(limit);
    c.header("Cache-Control", cache(30));
    return c.json(rows.map((r) => toSummary({ ...r.e, noteCount: r.noteCount }, r.a, origin(c))));
  })
  // Every page a search engine may list: addresses and when each last changed, nothing else. Sealed letters wait
  // until they open.
  .get("/sitemap", async (c) => {
    const rows = await c
      .get("db")
      .select({ handle: users.handle, slug: entries.slug, at: entries.updatedAt })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, isOpen))
      .orderBy(desc(entries.writtenAt))
      .limit(5000);
    c.header("Cache-Control", cache(600));
    return c.json(rows.map((r) => ({ handle: r.handle, slug: r.slug, at: r.at.toISOString() })));
  })
  .get("/latest", async (c) => {
    const [row] = await readable(c)
      .where(and(isReadable, byAuthor(c.req.query("author"))))
      .orderBy(desc(entries.writtenAt))
      .limit(1);
    if (!row) return c.json({ error: "no entries yet" }, 404);
    c.header("Cache-Control", cache(30));
    const counts = (await countsFor(c, "entry", [row.e.id])).get(row.e.id);
    return c.json(toEntry({ ...row.e, noteCount: row.noteCount }, row.a, origin(c), counts));
  })
  .get("/by/:handle/:slug", async (c) => {
    const [row] = await readable(c)
      .where(and(isReadable, byAuthor(c.req.param("handle")), eq(entries.slug, c.req.param("slug"))))
      .limit(1);
    if (!row) return c.json({ error: "not found" }, 404);
    c.header("Cache-Control", cache(30));
    const counts = (await countsFor(c, "entry", [row.e.id])).get(row.e.id);
    return c.json(toEntry({ ...row.e, noteCount: row.noteCount }, row.a, origin(c), counts));
  })
  .post("/:id/read", async (c) => {
    const id = positiveId(c.req.param("id"));
    const entry = id ? await readableEntry(c, id) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    const counted = await allow(c, `read:${entry.id}`, 1, 1800);
    const [row] = counted
      ? await db
          .update(entries)
          .set({ readCount: sql`${entries.readCount} + 1` })
          .where(eq(entries.id, entry.id))
          .returning({ readCount: entries.readCount })
      : await db.select({ readCount: entries.readCount }).from(entries).where(eq(entries.id, entry.id));
    return c.json(row);
  })
  .post("/:id/buzz", async (c) => {
    if (!(await allow(c, "buzz", 5, 60))) return c.json({ error: "too many buzzes, give it a minute" }, 429);
    const id = positiveId(c.req.param("id"));
    const entry = id ? await readableEntry(c, id) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(entries)
      .set({ buzzCount: sql`${entries.buzzCount} + 1` })
      .where(eq(entries.id, entry.id))
      .returning({ buzzCount: entries.buzzCount });
    publish(c, [`entry:${entry.id}`], { type: "buzz", entryId: entry.id });
    await notify(c, entry.authorId, {
      kind: "buzz",
      text: `Someone BUZZed ${quote(entry.title)}!`,
      link: `/u/${entry.handle}/${entry.slug}`,
    });
    return c.json(row);
  })
  .get("/:id/notes", async (c) => {
    const id = positiveId(c.req.param("id"));
    const entry = id ? await readableEntry(c, id) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    const rows = await c
      .get("db")
      .select({ n: notes, m: { avatar: users.avatar, handle: users.handle } })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.userId))
      .where(and(eq(notes.entryId, entry.id), eq(notes.status, "visible")))
      .orderBy(asc(notes.createdAt))
      .limit(200);
    c.header("Cache-Control", "public, max-age=10, s-maxage=10");
    const counts = await countsFor(
      c,
      "note",
      rows.map((r) => r.n.id),
    );
    return c.json(rows.map((r) => toNote(r.n, r.m, counts.get(r.n.id))));
  })
  .post("/:id/notes", json(noteInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "note", 5, 600))) return c.json({ error: "slow down a little, try again soon" }, 429);
    const nameProblem = await anonymousNameProblem(c, input.name);
    if (nameProblem) return c.json({ error: nameProblem }, 409);
    const id = positiveId(c.req.param("id"));
    const entry = id ? await readableEntry(c, id) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    const thread = input.parentId ? await threadOf(c, entry.id, input.parentId) : null;
    if (input.parentId && !thread) return c.json({ error: "that note is gone" }, 404);
    const status = looksLikeSpam(input.body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(notes)
      .values({
        entryId: entry.id,
        parentId: thread?.id ?? null,
        name: input.name,
        body: input.body,
        song: input.song ? toSticker(input.song) : null,
        status,
        ipHash: await ipHash(c),
      })
      .returning();
    const note = toNote(row!);
    if (status === "visible") publish(c, [`entry:${entry.id}`], { type: "note", entryId: entry.id, note });
    const link = `/u/${entry.handle}/${entry.slug}`;
    const actor = { name: input.name, avatar: null };
    if (thread?.userId && status === "visible")
      await notify(c, thread.userId, {
        kind: "reply",
        text: `${input.name} replied to your note on ${quote(entry.title)}`,
        link,
        actor,
      });
    if (thread?.userId !== entry.authorId)
      await notify(c, entry.authorId, {
        kind: status === "pending" ? "pending" : "note",
        text:
          status === "pending"
            ? `A note from ${input.name} on ${quote(entry.title)} is waiting for you`
            : `${input.name} left a note on ${quote(entry.title)}`,
        link,
        actor,
      });
    return c.json({ note, pending: status === "pending" }, 201);
  })
  /** A guest reacts to a page; members react through the web server, counted by account. */
  .post("/:id/react", json(reactInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await allow(c, "react", 60, 600))) return c.json({ error: "slow down a little" }, 429);
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const counts = await react(c, "entry", id, `ip:${await ipHash(c)}`, input.kind, {
      name: "Someone",
      avatar: null,
      userId: null,
    });
    return counts ? c.json({ reactions: counts }) : c.json({ error: "not found" }, 404);
  })
  .post("/notes/:noteId/react", json(reactInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await allow(c, "react", 60, 600))) return c.json({ error: "slow down a little" }, 429);
    const id = positiveId(c.req.param("noteId"));
    if (!id) return c.json({ error: "not found" }, 404);
    const counts = await react(c, "note", id, `ip:${await ipHash(c)}`, input.kind, {
      name: "Someone",
      avatar: null,
      userId: null,
    });
    return counts ? c.json({ reactions: counts }) : c.json({ error: "not found" }, 404);
  })
  /** Which reactions this guest left on a page and its notes (by their hashed IP; never anyone else's). */
  .get("/:id/reactions/mine", async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ entry: null, notes: {} });
    c.header("Cache-Control", "private, no-store");
    return c.json(await mine(c, `ip:${await ipHash(c)}`, id));
  })
  /** A guest reports a note; three different readers hide it until the moderator looks. */
  .post("/notes/:noteId/report", json(reportInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "report", 10, 3600))) return c.json({ error: "too many reports, try later" }, 429);
    const id = positiveId(c.req.param("noteId"));
    const done = id ? await fileNoteReport(c, id, `ip:${await ipHash(c)}`, input.reason) : null;
    if (!done) return c.json({ error: "not found" }, 404);
    if (done.hidden) publish(c, [`entry:${done.entryId}`], { type: "note-gone", entryId: done.entryId, noteId: id! });
    return c.json({ ok: true });
  })
  /** A guest reports a page. Members report through the web server, so it counts them by account instead. */
  .post("/:id/report", json(reportInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "report", 10, 3600))) return c.json({ error: "too many reports, try later" }, 429);
    const id = positiveId(c.req.param("id"));
    const entry = id ? await readableEntry(c, id) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    await fileReport(c, entry.id, `ip:${await ipHash(c)}`, input.reason);
    return c.json({ ok: true });
  });
