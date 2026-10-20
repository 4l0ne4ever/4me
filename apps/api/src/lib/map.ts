import {
  type Almost,
  type Author,
  avatarUrl,
  type Blast,
  type Entry,
  type EntrySummary,
  type Note,
  type Photo,
  type Shout,
} from "@4me/shared";
import type { almost, blasts, entries, notes, shouts } from "../db/schema";

type EntryRow = typeof entries.$inferSelect & { noteCount?: number };
export type AuthorRow = { handle: string; name: string; avatar: string };

export const toAuthor = (a: AuthorRow): Author => ({ handle: a.handle, name: a.name, avatar: avatarUrl(a.avatar) });

/** Uploaded photos are stored as "/media/…" and served by this API; older ones are the web app's own files. */
const photoUrl = (url: string, origin: string) => (url.startsWith("/media/") ? `${origin}${url}` : url);
const withOrigin = (p: Photo, origin: string): Photo => ({ ...p, url: photoUrl(p.url, origin) });

function song(row: EntryRow) {
  if (!row.songUrl && !row.songTitle) return null;
  return {
    title: row.songTitle ?? "",
    artist: row.songArtist ?? "",
    url: row.songUrl ?? "",
    embedUrl: row.songEmbedUrl,
    coverUrl: row.songCoverUrl,
    previewUrl: row.songPreviewUrl,
  };
}

export function toSummary(row: EntryRow, author: AuthorRow, origin: string): EntrySummary {
  const cover = row.photos[0];
  return {
    id: row.id,
    slug: row.slug,
    author: toAuthor(author),
    title: row.title,
    mood: row.mood,
    weather: row.weather,
    writtenAt: row.writtenAt.toISOString(),
    song: song(row),
    cover: cover ? withOrigin(cover, origin) : null,
    noteCount: Number(row.noteCount ?? 0),
  };
}

export function toEntry(row: EntryRow, author: AuthorRow, origin: string): Entry {
  return {
    ...toSummary(row, author, origin),
    body: row.body,
    photos: row.photos.map((p) => withOrigin(p, origin)),
    visibility: row.visibility,
    readCount: row.readCount,
    buzzCount: row.buzzCount,
  };
}

type MemberRow = { avatar: string | null; handle: string | null } | null | undefined;
const member = (userId: number | null, m: MemberRow) =>
  userId && m?.handle ? { avatar: avatarUrl(m.avatar), handle: m.handle } : null;

export const toNote = (r: typeof notes.$inferSelect, m?: MemberRow): Note => ({
  id: r.id,
  name: r.name,
  body: r.body,
  isAuthor: r.isAuthor,
  member: member(r.userId, m),
  createdAt: r.createdAt.toISOString(),
});
export const toShout = (r: typeof shouts.$inferSelect, m?: MemberRow): Shout => ({
  id: r.id,
  name: r.name,
  body: r.body,
  member: member(r.userId, m),
  createdAt: r.createdAt.toISOString(),
});
export const toBlast = (r: typeof blasts.$inferSelect): Blast => ({
  id: r.id,
  body: r.body,
  createdAt: r.createdAt.toISOString(),
});
export const toAlmost = (r: typeof almost.$inferSelect): Almost => ({
  id: r.id,
  body: r.body,
  deletedAt: r.deletedAt.toISOString(),
});
