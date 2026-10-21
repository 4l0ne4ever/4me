import { type SearchResults, searchable } from "@4me/shared";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Hono } from "hono";
import { entries, users } from "../db/schema";
import type { AppEnv } from "../env";
import { authorCols, isOpen, isReadable, noteCount, origin } from "../lib/entries";
import { allow } from "../lib/guard";
import { toAuthor, toSummary } from "../lib/map";

const like = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

/** People (by name or address) and public pages (by title or text), accents or not: "mua" finds "mưa". */
export const searchRoutes = new Hono<AppEnv>().get("/search", async (c) => {
  const raw = (c.req.query("q") ?? "").trim().slice(0, 80);
  const q = searchable(raw);
  if (q.length < 2) return c.json({ people: [], pages: [] } satisfies SearchResults);
  if (!(await allow(c, "search", 40, 60))) return c.json({ error: "searching too fast, give it a moment" }, 429);
  const db = c.get("db");
  // Rows saved before accents were dropped still match on their lower-cased text.
  const words = [...new Set([like(q), like(raw.toLowerCase())])];
  const [people, pages] = await Promise.all([
    db
      .select({ handle: users.handle, name: users.displayName, avatar: users.avatar, bio: users.bio })
      .from(users)
      .where(and(eq(users.status, "active"), or(...words.map((w) => ilike(users.searchName, w)))))
      .orderBy(desc(users.lastSeenAt))
      .limit(8),
    db
      .select({ e: entries, a: authorCols, noteCount })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, isOpen, or(...words.map((w) => ilike(entries.searchText, w)))))
      .orderBy(desc(entries.writtenAt))
      .limit(15),
  ]);
  c.header("Cache-Control", "public, max-age=30, s-maxage=30");
  return c.json({
    people: people.map((p) => ({ ...toAuthor(p), bio: p.bio })),
    pages: pages.map((r) => toSummary({ ...r.e, noteCount: r.noteCount }, r.a, origin(c))),
  } satisfies SearchResults);
});
