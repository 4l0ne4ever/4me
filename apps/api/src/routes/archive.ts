import type { Star } from "@4me/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { entries, users } from "../db/schema";
import type { AppEnv } from "../env";
import { isReadable } from "../lib/entries";
import { isSealed } from "../lib/map";

/**
 * Every readable page of a diary (or of everyone), as stars for the archive's night sky: when it was written, and
 * how much it was answered (notes and reactions together). Sealed letters are there too, dim, with their date.
 */
export const archiveRoutes = new Hono<AppEnv>().get("/archive", async (c) => {
  const handle = c.req.query("author")?.toLowerCase();
  const rows = await c
    .get("db")
    .select({
      id: entries.id,
      slug: entries.slug,
      title: entries.title,
      mood: entries.mood,
      writtenAt: entries.writtenAt,
      opensAt: entries.opensAt,
      handle: users.handle,
      name: users.displayName,
      glow: sql<number>`(
        (select count(*) from "notes" n where n."entry_id" = "entries"."id" and n."status" = 'visible') +
        (select count(*) from "reactions" r where r."target" = 'entry' and r."target_id" = "entries"."id")
      )::int`,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(isReadable, handle ? eq(users.handle, handle) : undefined))
    .orderBy(desc(entries.writtenAt))
    .limit(handle ? 2000 : 500);
  const stars: Star[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    mood: isSealed(r) ? "" : r.mood,
    writtenAt: r.writtenAt.toISOString(),
    author: { handle: r.handle, name: r.name },
    glow: r.glow,
    sealedUntil: isSealed(r) ? r.opensAt!.toISOString() : null,
  }));
  c.header("Cache-Control", "public, max-age=60, s-maxage=120");
  return c.json(stars);
});
