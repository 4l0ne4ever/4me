import type { DiaryExport } from "@4me/shared";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { almost, blasts, entries, notes, shouts, users } from "../db/schema";
import type { AppEnv } from "../env";

/**
 * Everything one member wrote, for them to keep: every page (private ones and sealed letters too), what readers
 * left on them, blasts, the almost-posted bin and their guestbook. Photos are listed by address; the browser
 * fetches them into the zip.
 */
export async function diaryExport(c: Context<AppEnv>, id: number): Promise<DiaryExport | null> {
  const db = c.get("db");
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) return null;
  const pages = await db.select().from(entries).where(eq(entries.authorId, id)).orderBy(asc(entries.writtenAt));
  const ids = pages.map((p) => p.id);
  const pageNotes = ids.length
    ? await db
        .select()
        .from(notes)
        .where(and(inArray(notes.entryId, ids), eq(notes.status, "visible")))
        .orderBy(asc(notes.createdAt))
    : [];
  const [myBlasts, myBin, myShouts] = await Promise.all([
    db.select().from(blasts).where(eq(blasts.authorId, id)).orderBy(desc(blasts.createdAt)),
    db.select().from(almost).where(eq(almost.authorId, id)).orderBy(desc(almost.deletedAt)),
    db
      .select()
      .from(shouts)
      .where(and(eq(shouts.ownerId, id), eq(shouts.status, "visible")))
      .orderBy(asc(shouts.createdAt)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    writer: {
      name: u.displayName,
      handle: u.handle,
      bio: u.bio,
      joinedAt: u.createdAt.toISOString(),
      lastfm: u.lastfmUser || null,
    },
    pages: pages.map((p) => ({
      title: p.title,
      slug: p.slug,
      body: p.body,
      mood: p.mood,
      weather: p.weather,
      writtenAt: p.writtenAt.toISOString(),
      visibility: p.visibility,
      opensAt: p.opensAt?.toISOString() ?? null,
      song: p.songTitle ? { title: p.songTitle, artist: p.songArtist ?? "", url: p.songUrl || null } : null,
      photos: p.photos,
      readCount: p.readCount,
      notes: pageNotes
        .filter((n) => n.entryId === p.id)
        .map((n) => ({ id: n.id, replyTo: n.parentId, name: n.name, body: n.body, at: n.createdAt.toISOString() })),
    })),
    blasts: myBlasts.map((b) => ({ body: b.body, at: b.createdAt.toISOString() })),
    almost: myBin.map((a) => ({ body: a.body, at: a.deletedAt.toISOString() })),
    guestbook: myShouts.map((s) => ({ name: s.name, body: s.body, at: s.createdAt.toISOString() })),
  };
}
