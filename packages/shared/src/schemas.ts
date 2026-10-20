import { z } from "zod";
import { handle } from "./accounts";

const name = z
  .string()
  .trim()
  .max(32)
  .transform((v) => v || "a stranger");

/** Public writes: a note on an entry, a shout in the guestbook. */
export const noteInput = z.object({
  name: name.default("a stranger"),
  body: z.string().trim().min(1).max(500),
  turnstileToken: z.string().max(2048).optional(),
});
export type NoteInput = z.input<typeof noteInput>;

/** A signed-in reader writes under their own name, so only the text is needed. */
export const memberNoteInput = z.object({ body: z.string().trim().min(1).max(500) });
export const memberShoutInput = z.object({ body: z.string().trim().min(1).max(280), owner: handle.optional() });

/** `owner` signs that member's guestbook; without it, the shared one on the front desktop. */
export const shoutInput = z.object({
  name: name.default("a stranger"),
  body: z.string().trim().min(1).max(280),
  owner: handle.optional(),
  turnstileToken: z.string().max(2048).optional(),
});
export type ShoutInput = z.input<typeof shoutInput>;

const photo = z.object({
  url: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(120).default(""),
});

/** A photo a member uploaded: the path the upload returned, and an optional caption. */
const uploadedPhoto = z.object({
  url: z.string().regex(/^\/media\/u\/\d+\/[a-z0-9-]{8,64}\.jpg$/, "upload the photo first"),
  caption: z.string().trim().max(120).default(""),
});

export const visibility = z.enum(["public", "private", "draft"]);
export type Visibility = z.infer<typeof visibility>;

/**
 * A member writes a night. The song is picked from the music search by its id and the server looks up the rest;
 * null removes the song, and leaving it out keeps the one already on the page.
 */
export const entryInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/, "lower-case letters, digits and dashes only")
    .max(80)
    .optional(),
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(20000),
  mood: z.string().trim().max(40).default(""),
  weather: z.string().trim().max(60).default(""),
  writtenAt: z.iso.datetime({ offset: true }).optional(),
  songId: z.number().int().positive().max(1e12).nullable().optional(),
  photos: z.array(uploadedPhoto).max(12).default([]),
  visibility: visibility.default("public"),
});
export type EntryInput = z.input<typeof entryInput>;

export const blastInput = z.object({ body: z.string().trim().min(1).max(140) });
export const almostInput = z.object({
  body: z.string().trim().min(1).max(280),
  deletedAt: z.iso.datetime({ offset: true }).optional(),
});
export const moderationInput = z.object({ status: z.enum(["visible", "hidden"]) });

export const reportReason = z.enum(["spam", "hurtful", "private", "other"]);
export const reportInput = z.object({
  reason: reportReason,
  turnstileToken: z.string().max(2048).optional(),
});
export const userStatusInput = z.object({ status: z.enum(["active", "suspended"]) });

/** What the API returns. */
export type Song = {
  title: string;
  artist: string;
  url: string;
  embedUrl: string | null;
  coverUrl: string | null;
  /** A 30-second clip that plays on the page. */
  previewUrl: string | null;
};

/** One hit from the music search. */
export type SongResult = {
  id: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  previewUrl: string | null;
  url: string;
};

/** Who wrote something: enough to show their picture and link to their desktop. */
export type Author = { handle: string; name: string; avatar: string };

/** A member's desktop, as the public sees it. */
export type Profile = Author & { bio: string; since: string; nights: number };

export type Photo = z.infer<typeof photo>;

export type EntrySummary = {
  id: number;
  slug: string;
  author: Author;
  title: string;
  mood: string;
  weather: string;
  writtenAt: string;
  song: Song | null;
  cover: Photo | null;
  noteCount: number;
};

export type Entry = EntrySummary & {
  body: string;
  photos: Photo[];
  visibility: Visibility;
  readCount: number;
  buzzCount: number;
};

/** `member` is set when a signed-in reader wrote it: their avatar and desktop, and the name is theirs alone. */
export type Member = { avatar: string; handle: string } | null;
export type Note = { id: number; name: string; body: string; isAuthor: boolean; member: Member; createdAt: string };
export type Shout = { id: number; name: string; body: string; member: Member; createdAt: string };
/** A member's own page, for the list in their Notepad. */
export type MyEntry = {
  id: number;
  slug: string;
  title: string;
  visibility: Visibility;
  status: "visible" | "hidden";
  writtenAt: string;
  noteCount: number;
};
/** A note on one of the member's own pages, for them to approve or hide. */
export type InboxNote = Note & { entryId: number; title: string; status: "visible" | "hidden" | "pending" };
export type Blast = { id: number; body: string; createdAt: string };
export type Almost = { id: number; body: string; deletedAt: string };
export type CatStats = { pets: number; fish: number; plays: number };
export type NowPlaying = { artist: string; title: string; url: string; image: string | null; live: boolean };

export type ApiError = { error: string; issues?: unknown };
