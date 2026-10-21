import { type entryInput, searchable, slugify } from "@4me/shared";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { z } from "zod";
import { entries, noteReports, notes, reports, uploads, users } from "../db/schema";
import type { AppEnv } from "../env";

// Written out with explicit table names: inside the subquery an unqualified "id" would mean notes.id.
export const noteCount = sql<number>`(select count(*)::int from "notes" n where n."entry_id" = "entries"."id" and n."status" = 'visible')`;

/** The author columns every page carries. Queries join `users` on `entries.author_id` to get them. */
export const authorCols = { handle: users.handle, name: users.displayName, avatar: users.avatar };

/** What anyone may read: public, not hidden by moderation, by a member who is not suspended. */
export const isReadable = and(
  eq(entries.visibility, "public"),
  eq(entries.status, "visible"),
  eq(users.status, "active"),
);

export const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** A public page by id, with its author and address, or null. */
export async function readableEntry(c: Context<AppEnv>, id: number) {
  const [row] = await c
    .get("db")
    .select({
      id: entries.id,
      authorId: entries.authorId,
      slug: entries.slug,
      title: entries.title,
      handle: users.handle,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(isReadable, eq(entries.id, id)))
    .limit(1);
  return row ?? null;
}

export const positiveId = (raw: string | undefined) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};

type EntryInput = z.output<typeof entryInput>;
type Existing = { slug: string } | undefined;

/**
 * The columns for a member's page. Photos must be their own uploads; leaving the song out keeps the one already on
 * the page. Returns a reason instead when something is not acceptable.
 */
export async function entryValues(
  c: Context<AppEnv>,
  authorId: number,
  input: EntryInput,
  existing?: Existing,
): Promise<{ values: Omit<typeof entries.$inferInsert, "authorId"> } | { problem: string; status: 400 }> {
  const prefix = `/media/u/${authorId}/`;
  const keys = input.photos.map((p) => p.url.slice("/media/".length));
  if (input.photos.some((p) => !p.url.startsWith(prefix))) return { problem: "those photos aren't yours", status: 400 };
  if (keys.length > 0) {
    const owned = await c
      .get("db")
      .select({ key: uploads.key })
      .from(uploads)
      .where(and(eq(uploads.userId, authorId), inArray(uploads.key, keys)));
    if (owned.length !== new Set(keys).size) return { problem: "a photo is missing, upload it again", status: 400 };
  }

  const writtenAt = input.writtenAt ? new Date(input.writtenAt) : new Date();
  const values: Omit<typeof entries.$inferInsert, "authorId"> = {
    slug: input.slug || existing?.slug || slugify(input.title, writtenAt),
    title: input.title,
    body: input.body,
    mood: input.mood,
    weather: input.weather,
    writtenAt,
    photos: input.photos,
    visibility: input.visibility,
    searchText: searchable(`${input.title} ${input.body}`),
    updatedAt: new Date(),
  };
  if (input.song === null) {
    Object.assign(values, {
      songId: null,
      songTitle: null,
      songArtist: null,
      songUrl: null,
      songEmbedUrl: null,
      songCoverUrl: null,
      songPreviewUrl: null,
    });
  } else if (input.song) {
    // Picked in the reader's browser from Apple's search; the schema already checked every link is Apple's.
    Object.assign(values, {
      songId: input.song.id,
      songTitle: input.song.title,
      songArtist: input.song.artist,
      songUrl: input.song.url || null,
      songEmbedUrl: null,
      songCoverUrl: input.song.coverUrl,
      songPreviewUrl: input.song.previewUrl,
    });
  }
  return { values };
}

/** Deletes uploaded photos that no page of this member uses any more: from the bucket, then from the list. */
export async function dropUnusedPhotos(c: Context<AppEnv>, userId: number, keys: string[]) {
  if (keys.length === 0) return;
  const db = c.get("db");
  const used = await db.select({ photos: entries.photos }).from(entries).where(eq(entries.authorId, userId));
  const inUse = new Set(used.flatMap((r) => r.photos.map((p) => p.url.slice("/media/".length))));
  const gone = [...new Set(keys)].filter((k) => !inUse.has(k));
  if (gone.length === 0) return;
  await Promise.allSettled(gone.map((k) => c.get("media")?.delete(k)));
  await db.delete(uploads).where(and(eq(uploads.userId, userId), inArray(uploads.key, gone)));
}

/** Photos uploaded more than a day ago and never put on a page. */
export async function dropAbandonedUploads(c: Context<AppEnv>, userId: number) {
  const stale = await c
    .get("db")
    .select({ key: uploads.key })
    .from(uploads)
    .where(and(eq(uploads.userId, userId), lt(uploads.createdAt, new Date(Date.now() - 86_400_000))));
  await dropUnusedPhotos(
    c,
    userId,
    stale.map((r) => r.key),
  );
}

export const photoKeys = (photos: { url: string }[]) =>
  photos.filter((p) => p.url.startsWith("/media/")).map((p) => p.url.slice("/media/".length));

/**
 * The top-level note a reply belongs to: replying to a reply answers its thread. Null when the note isn't a
 * visible note on this page.
 */
export async function threadOf(c: Context<AppEnv>, entryId: number, parentId: number) {
  const [parent] = await c
    .get("db")
    .select({ id: notes.id, parentId: notes.parentId, userId: notes.userId, name: notes.name })
    .from(notes)
    .where(and(eq(notes.id, parentId), eq(notes.entryId, entryId), eq(notes.status, "visible")))
    .limit(1);
  if (!parent) return null;
  if (!parent.parentId) return parent;
  return { ...parent, id: parent.parentId };
}

/** Records one report per reader per note, and hides the note once three different readers have reported it. */
export async function fileNoteReport(
  c: Context<AppEnv>,
  noteId: number,
  reporter: string,
  reason: (typeof noteReports.$inferInsert)["reason"],
): Promise<{ entryId: number; hidden: boolean } | null> {
  const db = c.get("db");
  const [note] = await db
    .select({ id: notes.id, entryId: notes.entryId })
    .from(notes)
    .innerJoin(entries, eq(entries.id, notes.entryId))
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(isReadable, eq(notes.id, noteId), eq(notes.status, "visible")))
    .limit(1);
  if (!note) return null;
  await db.insert(noteReports).values({ noteId, reporter, reason }).onConflictDoNothing();
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(noteReports)
    .where(eq(noteReports.noteId, noteId));
  const hidden = n >= REPORTS_TO_HIDE;
  if (hidden) await db.update(notes).set({ status: "hidden" }).where(eq(notes.id, noteId));
  return { entryId: note.entryId, hidden };
}

/** This many different readers reporting a page takes it down until the moderator has looked. */
export const REPORTS_TO_HIDE = 3;

/** Records one report per reader per page, and hides the page once enough different readers have reported it. */
export async function fileReport(
  c: Context<AppEnv>,
  entryId: number,
  reporter: string,
  reason: (typeof reports.$inferInsert)["reason"],
) {
  const db = c.get("db");
  await db.insert(reports).values({ entryId, reporter, reason }).onConflictDoNothing();
  const [entry] = await db.select({ clearedAt: entries.clearedAt }).from(entries).where(eq(entries.id, entryId));
  const since = entry?.clearedAt ?? new Date(0);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(eq(reports.entryId, entryId), gt(reports.createdAt, since)));
  if (n >= REPORTS_TO_HIDE) await db.update(entries).set({ status: "hidden" }).where(eq(entries.id, entryId));
}
