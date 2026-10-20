import { z } from "zod";

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
export const memberShoutInput = z.object({ body: z.string().trim().min(1).max(280) });

export const shoutInput = z.object({
  name: name.default("a stranger"),
  body: z.string().trim().min(1).max(280),
  turnstileToken: z.string().max(2048).optional(),
});
export type ShoutInput = z.input<typeof shoutInput>;

const photo = z.object({
  url: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(120).default(""),
});

export const visibility = z.enum(["public", "private", "draft"]);
export type Visibility = z.infer<typeof visibility>;

/** Author writes. */
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
  songUrl: z.union([z.url(), z.literal("")]).optional(),
  songTitle: z.string().trim().max(120).optional(),
  songArtist: z.string().trim().max(120).optional(),
  photos: z.array(photo).max(12).default([]),
  visibility: visibility.default("public"),
});
export type EntryInput = z.input<typeof entryInput>;

export const blastInput = z.object({ body: z.string().trim().min(1).max(140) });
export const almostInput = z.object({
  body: z.string().trim().min(1).max(280),
  deletedAt: z.iso.datetime({ offset: true }).optional(),
});
export const moderationInput = z.object({ status: z.enum(["visible", "hidden"]) });

/** What the API returns. */
export type Song = {
  title: string;
  artist: string;
  url: string;
  embedUrl: string | null;
  coverUrl: string | null;
};

export type Photo = z.infer<typeof photo>;

export type EntrySummary = {
  slug: string;
  title: string;
  mood: string;
  weather: string;
  writtenAt: string;
  song: Song | null;
  cover: Photo | null;
  noteCount: number;
};

export type Entry = EntrySummary & {
  id: number;
  body: string;
  photos: Photo[];
  visibility: Visibility;
  readCount: number;
  buzzCount: number;
};

/** `member` is set when a signed-in reader wrote it: their avatar, and the name is theirs alone. */
export type Member = { avatar: string } | null;
export type Note = { id: number; name: string; body: string; isAuthor: boolean; member: Member; createdAt: string };
export type Shout = { id: number; name: string; body: string; member: Member; createdAt: string };
export type Blast = { id: number; body: string; createdAt: string };
export type Almost = { id: number; body: string; deletedAt: string };
export type CatStats = { pets: number; fish: number; plays: number };
export type NowPlaying = { artist: string; title: string; url: string; image: string | null; live: boolean };

export type ApiError = { error: string; issues?: unknown };
