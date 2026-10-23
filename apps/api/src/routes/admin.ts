import { moderationInput, userStatusInput } from "@4me/shared";
import { desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { entries, errorEvents, nightLines, noteReports, notes, reports, shouts, users } from "../db/schema";
import type { AppEnv } from "../env";
import { positiveId } from "../lib/entries";
import { sameSecret } from "../lib/guard";
import { toNote, toShout } from "../lib/map";
import { json } from "../lib/validate";

const writer = alias(users, "writer");

/**
 * The site moderator's routes. Members write their own pages; the moderator only looks at reports, hides or
 * restores pages, suspends accounts, and approves held notes. The web server calls these with the ADMIN_TOKEN.
 */
export const adminRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !(await sameSecret(token, c.env.ADMIN_TOKEN))) return c.json({ error: "unauthorised" }, 401);
    await next();
  })
  /** A line in a night's poem taken down. */
  .delete("/lines/:id", async (c) => {
    const id = positiveId(c.req.param("id"));
    if (id) await c.get("db").update(nightLines).set({ status: "hidden" }).where(eq(nightLines.id, id));
    return c.json({ ok: true });
  })
  /** What has gone wrong on the site lately, newest first. */
  .get("/errors", async (c) => {
    const rows = await c.get("db").select().from(errorEvents).orderBy(desc(errorEvents.lastAt)).limit(100);
    return c.json(rows);
  })
  /** Seen to: the list starts again. */
  .delete("/errors", async (c) => {
    await c.get("db").delete(errorEvents);
    return c.json({ ok: true });
  })
  /** Pages with reports the moderator hasn't looked at yet, most reported first. */
  .get("/reports", async (c) => {
    const rows = await c
      .get("db")
      .select({
        id: entries.id,
        slug: entries.slug,
        title: entries.title,
        status: entries.status,
        handle: users.handle,
        author: users.displayName,
        count: sql<number>`count(${reports.id})::int`,
        reasons: sql<string[]>`array_agg(distinct ${reports.reason})`,
        latest: sql<string>`max(${reports.createdAt})`,
      })
      .from(reports)
      .innerJoin(entries, eq(entries.id, reports.entryId))
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(gt(reports.createdAt, sql`coalesce(${entries.clearedAt}, 'epoch'::timestamptz)`))
      .groupBy(entries.id, users.id)
      .orderBy(desc(sql`count(${reports.id})`), desc(sql`max(${reports.createdAt})`))
      .limit(100);
    return c.json(rows.map((r) => ({ ...r, latest: new Date(r.latest).toISOString() })));
  })
  /** Notes readers reported, most reported first, with the page they are on. */
  .get("/note-reports", async (c) => {
    const rows = await c
      .get("db")
      .select({
        id: notes.id,
        body: notes.body,
        name: notes.name,
        status: notes.status,
        slug: entries.slug,
        title: entries.title,
        handle: writer.handle,
        count: sql<number>`count(${noteReports.id})::int`,
        reasons: sql<string[]>`array_agg(distinct ${noteReports.reason})`,
      })
      .from(noteReports)
      .innerJoin(notes, eq(notes.id, noteReports.noteId))
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .innerJoin(writer, eq(writer.id, entries.authorId))
      .groupBy(notes.id, entries.id, writer.id)
      .orderBy(desc(sql`count(${noteReports.id})`))
      .limit(100);
    return c.json(rows);
  })
  .get("/entries/hidden", async (c) => {
    const rows = await c
      .get("db")
      .select({
        id: entries.id,
        slug: entries.slug,
        title: entries.title,
        handle: users.handle,
        author: users.displayName,
        updatedAt: entries.updatedAt,
      })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(eq(entries.status, "hidden"))
      .orderBy(desc(entries.updatedAt))
      .limit(100);
    return c.json(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
  })
  /** "visible" keeps a page up and clears its reports; "hidden" takes it down for everyone but its author. */
  .patch("/entries/:id", json(moderationInput), async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const { status } = c.req.valid("json");
    const [row] = await c
      .get("db")
      .update(entries)
      .set(status === "visible" ? { status, clearedAt: new Date() } : { status })
      .where(eq(entries.id, id))
      .returning({ id: entries.id, status: entries.status });
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  })
  .get("/users", async (c) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 60);
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = await c
      .get("db")
      .select({
        id: users.id,
        handle: users.handle,
        name: users.displayName,
        email: users.email,
        status: users.status,
        createdAt: users.createdAt,
        nights: sql<number>`(select count(*)::int from "entries" e where e."author_id" = "users"."id")`,
      })
      .from(users)
      .where(q ? or(ilike(users.handle, like), ilike(users.displayName, like), ilike(users.email, like)) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(50);
    return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  })
  /** A suspended member can still sign in and read, but can't write, and their desktop and pages are closed. */
  .patch("/users/:id", json(userStatusInput), async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(users)
      .set({ status: c.req.valid("json").status })
      .where(eq(users.id, id))
      .returning({ id: users.id, status: users.status });
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  })
  .get("/notes", async (c) => {
    const pending = c.req.query("status") === "pending";
    const rows = await c
      .get("db")
      .select({ n: notes, slug: entries.slug, title: entries.title, handle: writer.handle })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .innerJoin(writer, eq(writer.id, entries.authorId))
      .where(pending ? eq(notes.status, "pending") : undefined)
      .orderBy(desc(notes.createdAt))
      .limit(100);
    return c.json(
      rows.map((r) => ({ ...toNote(r.n), slug: r.slug, title: r.title, handle: r.handle, status: r.n.status })),
    );
  })
  .patch("/notes/:id", json(moderationInput), async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(notes)
      .set({ status: c.req.valid("json").status })
      .where(eq(notes.id, id))
      .returning();
    // Shown again by the moderator: its reports are settled.
    if (row?.status === "visible") await c.get("db").delete(noteReports).where(eq(noteReports.noteId, id));
    return row ? c.json(toNote(row)) : c.json({ error: "not found" }, 404);
  })
  .get("/shouts", async (c) => {
    const pending = c.req.query("status") === "pending";
    const rows = await c
      .get("db")
      .select({ s: shouts, owner: users.handle })
      .from(shouts)
      .leftJoin(users, eq(users.id, shouts.ownerId))
      .where(pending ? eq(shouts.status, "pending") : undefined)
      .orderBy(desc(shouts.createdAt))
      .limit(100);
    return c.json(rows.map((r) => ({ ...toShout(r.s), owner: r.owner, status: r.s.status })));
  })
  .patch("/shouts/:id", json(moderationInput), async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(shouts)
      .set({ status: c.req.valid("json").status })
      .where(eq(shouts.id, id))
      .returning();
    return row ? c.json(toShout(row)) : c.json({ error: "not found" }, 404);
  });
