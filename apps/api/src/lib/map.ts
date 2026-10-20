import type { Almost, Blast, Entry, EntrySummary, Note, Shout } from "@4me/shared";
import type { almost, blasts, entries, notes, shouts } from "../db/schema";

type EntryRow = typeof entries.$inferSelect & { noteCount?: number };

function song(row: EntryRow) {
  if (!row.songUrl && !row.songTitle) return null;
  return {
    title: row.songTitle ?? "",
    artist: row.songArtist ?? "",
    url: row.songUrl ?? "",
    embedUrl: row.songEmbedUrl,
    coverUrl: row.songCoverUrl,
  };
}

export function toSummary(row: EntryRow): EntrySummary {
  return {
    slug: row.slug,
    title: row.title,
    mood: row.mood,
    weather: row.weather,
    writtenAt: row.writtenAt.toISOString(),
    song: song(row),
    cover: row.photos[0] ?? null,
    noteCount: Number(row.noteCount ?? 0),
  };
}

export function toEntry(row: EntryRow): Entry {
  return {
    ...toSummary(row),
    id: row.id,
    body: row.body,
    photos: row.photos,
    visibility: row.visibility,
    readCount: row.readCount,
    buzzCount: row.buzzCount,
  };
}

export const toNote = (r: typeof notes.$inferSelect): Note => ({
  id: r.id,
  name: r.name,
  body: r.body,
  isAuthor: r.isAuthor,
  createdAt: r.createdAt.toISOString(),
});
export const toShout = (r: typeof shouts.$inferSelect): Shout => ({
  id: r.id,
  name: r.name,
  body: r.body,
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
