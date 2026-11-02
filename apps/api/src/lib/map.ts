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
import { type Links, type PageState, photoLink } from "./photo-links";

type EntryRow = typeof entries.$inferSelect & { noteCount?: number };
export type AuthorRow = { handle: string; name: string; avatar: string };

export const toAuthor = (a: AuthorRow): Author => ({ handle: a.handle, name: a.name, avatar: avatarUrl(a.avatar) });

/**
 * Uploaded photos are stored as "/media/…" and served by this API (older ones are the web app's own files). The
 * address depends on who may see the page now: see photo-links.ts.
 */
const pageState = (row: EntryRow): PageState => ({
  visibility: row.visibility,
  status: row.status,
  sealed: isSealed(row),
});
const linked = (p: Photo, row: EntryRow, links: Links): Photo => ({
  ...p,
  url: photoLink(links, p.url, row.id, pageState(row)),
});

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
export function toSummary(row: EntryRow, author: AuthorRow, links: Links, reveal = false): EntrySummary {
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
    cover: cover ? linked(cover, row, links) : null,
    noteCount: Number(row.noteCount ?? 0),
    sealedUntil: sealed ? row.opensAt!.toISOString() : null,
    prompt: row.prompt ?? null,
    shift: row.eventId ?? null,
  };
}

export function toEntry(
  row: EntryRow,
  author: AuthorRow,
  links: Links,
  reactions: Reactions = {},
  reveal = false,
): Entry {
  const hide = isSealed(row) && !reveal;
  return {
    ...toSummary(row, author, links, reveal),
    body: hide ? "" : row.body,
    reactions: hide ? {} : reactions,
    photos: hide ? [] : row.photos.map((p) => linked(p, row, links)),
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
  song: r.song ?? null,
  createdAt: r.createdAt.toISOString(),
  editedAt: r.editedAt?.toISOString() ?? null,
});
export const toShout = (r: typeof shouts.$inferSelect, m?: MemberRow): Shout => ({
  id: r.id,
  name: r.name,
  body: r.body,
  member: member(r.userId, m),
  song: r.song ?? null,
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
