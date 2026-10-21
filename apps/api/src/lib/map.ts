import {
  type Almost,
  type Author,
  avatarUrl,
  type Blast,
  type Entry,
  type EntrySummary,
  type Note,
  type Photo,
  type Reactions,
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

/** A sealed letter still waiting for its day. */
export const isSealed = (row: { opensAt: Date | null }, now = Date.now()) =>
  row.opensAt !== null && row.opensAt.getTime() > now;

/**
 * A page as readers see it. While it is a sealed letter only its title, writer and dates show; `reveal` is for its
 * writer, who always sees everything.
 */
export function toSummary(row: EntryRow, author: AuthorRow, origin: string, reveal = false): EntrySummary {
  const sealed = isSealed(row);
  const cover = sealed && !reveal ? undefined : row.photos[0];
  return {
    id: row.id,
    slug: row.slug,
    author: toAuthor(author),
    title: row.title,
    mood: row.mood,
    weather: row.weather,
    writtenAt: row.writtenAt.toISOString(),
    song: sealed && !reveal ? null : song(row),
    cover: cover ? withOrigin(cover, origin) : null,
    noteCount: Number(row.noteCount ?? 0),
    sealedUntil: sealed ? row.opensAt!.toISOString() : null,
  };
}

export function toEntry(
  row: EntryRow,
  author: AuthorRow,
  origin: string,
  reactions: Reactions = {},
  reveal = false,
): Entry {
  const hide = isSealed(row) && !reveal;
  return {
    ...toSummary(row, author, origin, reveal),
    body: hide ? "" : row.body,
    reactions: hide ? {} : reactions,
    photos: hide ? [] : row.photos.map((p) => withOrigin(p, origin)),
    visibility: row.visibility,
    readCount: row.readCount,
    buzzCount: row.buzzCount,
  };
}

type MemberRow = { avatar: string | null; handle: string | null } | null | undefined;
const member = (userId: number | null, m: MemberRow) =>
  userId && m?.handle ? { avatar: avatarUrl(m.avatar), handle: m.handle } : null;

export const toNote = (r: typeof notes.$inferSelect, m?: MemberRow, reactions: Reactions = {}): Note => ({
  id: r.id,
  parentId: r.parentId,
  name: r.name,
  body: r.body,
  isAuthor: r.isAuthor,
  member: member(r.userId, m),
  reactions,
  createdAt: r.createdAt.toISOString(),
  editedAt: r.editedAt?.toISOString() ?? null,
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
