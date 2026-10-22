import { and, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { diaryBans, entries, notes, shouts } from "../db/schema";
import type { AppEnv } from "../env";
import { positiveId } from "../lib/entries";
import { allowKey } from "../lib/guard";
import { json } from "../lib/validate";

const banInput = z
  .object({
    noteId: z.number().int().positive().optional(),
    shoutId: z.number().int().positive().optional(),
    /** Take the note or shout down too. */
    remove: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.noteId) !== Boolean(v.shoutId), "one note or one shout");

/** A writer keeping someone off their diary, from a note on their page or a shout in their guestbook. */
export const banRoutes = new Hono<AppEnv>()
  .post("/users/:id/bans", json(banInput), async (c) => {
    const owner = positiveId(c.req.param("id"));
    if (!owner) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `ban:${owner}`, 30, 3600))) return c.json({ error: "slow down a little" }, 429);
    const { noteId, shoutId, remove } = c.req.valid("json");
    const db = c.get("db");
    // Who wrote it, and is it on this writer's diary?
    let who: { userId: number | null; ipHash: string | null; name: string } | null = null;
    if (noteId) {
      const [n] = await db
        .select({ userId: notes.userId, ipHash: notes.ipHash, name: notes.name, authorId: entries.authorId })
        .from(notes)
        .innerJoin(entries, eq(entries.id, notes.entryId))
        .where(eq(notes.id, noteId))
        .limit(1);
      if (n && n.authorId === owner) who = n;
    } else if (shoutId) {
      const [s] = await db
        .select({ userId: shouts.userId, ipHash: shouts.ipHash, name: shouts.name, ownerId: shouts.ownerId })
        .from(shouts)
        .where(eq(shouts.id, shoutId))
        .limit(1);
      if (s && s.ownerId === owner) who = s;
    }
    if (!who) return c.json({ error: "not found" }, 404);
    if (who.userId === owner) return c.json({ error: "that's you" }, 400);
    if (!who.userId && !who.ipHash) return c.json({ error: "there's no way to tell who wrote that one" }, 400);
    const [ban] = await db
      .insert(diaryBans)
      .values({ ownerId: owner, userId: who.userId, ipHash: who.userId ? null : who.ipHash, label: who.name })
      .onConflictDoNothing()
      .returning();
    if (remove) {
      if (noteId) await db.delete(notes).where(or(eq(notes.id, noteId), eq(notes.parentId, noteId)));
      if (shoutId) await db.delete(shouts).where(eq(shouts.id, shoutId));
    }
    return c.json({ ok: true, ban: ban ?? null }, 201);
  })
  .get("/users/:id/bans", async (c) => {
    const owner = positiveId(c.req.param("id"));
    if (!owner) return c.json([]);
    const rows = await c
      .get("db")
      .select()
      .from(diaryBans)
      .where(eq(diaryBans.ownerId, owner))
      .orderBy(desc(diaryBans.createdAt))
      .limit(200);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.userId ? "member" : "guest",
        createdAt: r.createdAt.toISOString(),
      })),
    );
  })
  .delete("/users/:id/bans/:banId", async (c) => {
    const owner = positiveId(c.req.param("id"));
    const id = positiveId(c.req.param("banId"));
    if (owner && id)
      await c
        .get("db")
        .delete(diaryBans)
        .where(and(eq(diaryBans.id, id), eq(diaryBans.ownerId, owner)));
    return c.json({ ok: true });
  })
  /** The guestbook's owner takes a shout down. */
  .delete("/users/:id/shouts/:shoutId", async (c) => {
    const owner = positiveId(c.req.param("id"));
    const id = positiveId(c.req.param("shoutId"));
    if (!owner || !id) return c.json({ error: "not found" }, 404);
    const [gone] = await c
      .get("db")
      .delete(shouts)
      .where(and(eq(shouts.id, id), eq(shouts.ownerId, owner)))
      .returning({ id: shouts.id });
    return gone ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
