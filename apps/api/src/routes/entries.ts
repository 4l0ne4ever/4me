import { noteInput } from "@4me/shared";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { entries, notes, users } from "../db/schema";
import type { AppEnv } from "../env";
import { allow, humanCheck, ipHash, looksLikeSpam } from "../lib/guard";
import { toEntry, toNote, toSummary } from "../lib/map";
import { anonymousNameProblem } from "../lib/names";
import { json } from "../lib/validate";

// Written out with explicit table names: inside the subquery an unqualified "id" would mean notes.id.
export const noteCount = sql<number>`(select count(*)::int from "notes" n where n."entry_id" = "entries"."id" and n."status" = 'visible')`;
const isPublic = eq(entries.visibility, "public");
const cache = (seconds: number) => `public, max-age=${seconds}, s-maxage=${seconds * 2}, stale-while-revalidate=300`;

export const entryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 50);
    const before = c.req.query("before");
    const beforeDate = before ? new Date(before) : null;
    const where =
      beforeDate && !Number.isNaN(beforeDate.getTime()) ? and(isPublic, lt(entries.writtenAt, beforeDate)) : isPublic;
    const rows = await c
      .get("db")
      .select({ e: entries, noteCount })
      .from(entries)
      .where(where)
      .orderBy(desc(entries.writtenAt))
      .limit(limit);
    c.header("Cache-Control", cache(30));
    return c.json(rows.map((r) => toSummary({ ...r.e, noteCount: r.noteCount })));
  })
  .get("/latest", async (c) => {
    const [row] = await c
      .get("db")
      .select({ e: entries, noteCount })
      .from(entries)
      .where(isPublic)
      .orderBy(desc(entries.writtenAt))
      .limit(1);
    if (!row) return c.json({ error: "no entries yet" }, 404);
    c.header("Cache-Control", cache(30));
    return c.json(toEntry({ ...row.e, noteCount: row.noteCount }));
  })
  .get("/:slug", async (c) => {
    const [row] = await c
      .get("db")
      .select({ e: entries, noteCount })
      .from(entries)
      .where(and(isPublic, eq(entries.slug, c.req.param("slug"))))
      .limit(1);
    if (!row) return c.json({ error: "not found" }, 404);
    c.header("Cache-Control", cache(30));
    return c.json(toEntry({ ...row.e, noteCount: row.noteCount }));
  })
  .post("/:slug/read", async (c) => {
    const db = c.get("db");
    const slug = c.req.param("slug");
    const counted = await allow(c, `read:${slug}`, 1, 1800);
    const [row] = counted
      ? await db
          .update(entries)
          .set({ readCount: sql`${entries.readCount} + 1` })
          .where(and(isPublic, eq(entries.slug, slug)))
          .returning({ readCount: entries.readCount })
      : await db
          .select({ readCount: entries.readCount })
          .from(entries)
          .where(and(isPublic, eq(entries.slug, slug)));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  })
  .post("/:slug/buzz", async (c) => {
    if (!(await allow(c, "buzz", 5, 60))) return c.json({ error: "too many buzzes, give it a minute" }, 429);
    const [row] = await c
      .get("db")
      .update(entries)
      .set({ buzzCount: sql`${entries.buzzCount} + 1` })
      .where(and(isPublic, eq(entries.slug, c.req.param("slug"))))
      .returning({ buzzCount: entries.buzzCount });
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  })
  .get("/:slug/notes", async (c) => {
    const db = c.get("db");
    const rows = await db
      .select({ n: notes, avatar: users.avatar })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .leftJoin(users, eq(users.id, notes.userId))
      .where(and(isPublic, eq(entries.slug, c.req.param("slug")), eq(notes.status, "visible")))
      .orderBy(asc(notes.createdAt))
      .limit(200);
    c.header("Cache-Control", "public, max-age=10, s-maxage=10");
    return c.json(rows.map((r) => toNote(r.n, r.avatar)));
  })
  .post("/:slug/notes", json(noteInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "note", 5, 600))) return c.json({ error: "slow down a little, try again soon" }, 429);
    const nameProblem = await anonymousNameProblem(c, input.name);
    if (nameProblem) return c.json({ error: nameProblem }, 409);
    const db = c.get("db");
    const [entry] = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(isPublic, eq(entries.slug, c.req.param("slug"))));
    if (!entry) return c.json({ error: "not found" }, 404);
    const status = looksLikeSpam(input.body) ? "pending" : "visible";
    const [row] = await db
      .insert(notes)
      .values({ entryId: entry.id, name: input.name, body: input.body, status, ipHash: await ipHash(c) })
      .returning();
    return c.json({ note: toNote(row!), pending: status === "pending" }, 201);
  });
