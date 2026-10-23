import { z } from "zod";
import { songPick } from "./music";

const name = z
  .string()
  .trim()
  .max(32)
  .transform((v) => v || "a stranger");

/** Public writes: a note on an entry (or a reply to one), a shout in the guestbook. */
export const noteInput = z.object({
  name: name.default("a stranger"),
  body: z.string().trim().min(1).max(500),
  parentId: z.number().int().positive().optional(),
  song: songPick.optional(),
  turnstileToken: z.string().max(2048).optional(),
});
export type NoteInput = z.input<typeof noteInput>;

/** A signed-in reader writes under their own name, so only the text is needed. */
export const memberNoteInput = z.object({
  body: z.string().trim().min(1).max(500),
  parentId: z.number().int().positive().optional(),
  song: songPick.optional(),
});

/** How a reader feels about a page or a note: one at a time, like Yahoo 360 smileys. */
export const REACTIONS = [
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "hug", emoji: "🤗", label: "Hug" },
  { id: "haha", emoji: "😂", label: "Haha" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "sad", emoji: "😢", label: "Sad" },
  { id: "moon", emoji: "🌙", label: "Goodnight" },
] as const;
export type ReactionKind = (typeof REACTIONS)[number]["id"];
export const reactionKind = z.enum(REACTIONS.map((r) => r.id) as [ReactionKind, ...ReactionKind[]]);
/** Counts per kind; kinds nobody chose are left out. */
export type Reactions = Partial<Record<ReactionKind, number>>;
/** `kind: null` takes the reader's reaction back. */
export const reactInput = z.object({
  kind: reactionKind.nullable(),
  turnstileToken: z.string().max(2048).optional(),
});
export const editNoteInput = z.object({ body: z.string().trim().min(1).max(500) });

export const memberReactInput = z.object({
  target: z.enum(["entry", "note"]),
  targetId: z.number().int().positive(),
  kind: reactionKind.nullable(),
});
/** Whose guestbook: a desktop address. The API looks the member up ("4me", the first diary, is reserved but real). */
const guestbookOwner = z.string().trim().min(1).max(24);

export const memberShoutInput = z.object({
  body: z.string().trim().min(1).max(280),
  owner: guestbookOwner,
  song: songPick.optional(),
});

/** A guestbook belongs to a diary: `owner` is whose guestbook is signed. */
export const shoutInput = z.object({
  name: name.default("a stranger"),
  body: z.string().trim().min(1).max(280),
  owner: guestbookOwner,
  song: songPick.optional(),
  turnstileToken: z.string().max(2048).optional(),
});
export type ShoutInput = z.input<typeof shoutInput>;

/** One line for tonight's shared poem: short, and no links (it is a poem, not a noticeboard). */
const lineBody = z
  .string()
  .trim()
  .min(2, "a line, at least")
  .max(120, "one line: 120 characters at most")
  .refine((v) => !/https?:\/\/|www\.|\.(com|net|org|vn)\b/i.test(v), "no links in the poem")
  .transform((v) => v.replace(/\s+/g, " "));
export const lineInput = z.object({
  name: name.default("a stranger"),
  body: lineBody,
  turnstileToken: z.string().max(2048).optional(),
});
export const memberLineInput = z.object({ body: lineBody });
/** A line in a night's shared poem, and who added it. */
export type NightLine = { id: number; night: string; name: string; body: string; member: Member; createdAt: string };

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
 * A member writes a night. The song is the one picked in the music search; null removes it, and leaving it out
 * keeps the one already on the page.
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
  song: songPick.nullable().optional(),
  photos: z.array(uploadedPhoto).max(12).default([]),
  visibility: visibility.default("public"),
  /** Seals the page until then, a letter to the future; null opens it now. */
  opensAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** The page answers its night's question; false takes that back, leaving it out keeps it as it is. */
  answering: z.boolean().optional(),
  /** Written in this night shift: sealed until it ends, then opened with everyone else's. Only a new page. */
  shift: z.number().int().positive().optional(),
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

/** A song stuck on a note or a guestbook shout: what it is, its cover, and its 30-second clip. */
export type SongSticker = Pick<Song, "title" | "artist" | "url" | "coverUrl" | "previewUrl">;

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
export type Profile = Author & { bio: string; since: string; nights: number; subscribers: number };

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
  /** Set while the page is a sealed letter: until then only its title, writer and dates show. */
  sealedUntil: string | null;
  /** The night whose question the page answers ("2026-10-22"), if it does. */
  prompt: string | null;
  /** The night shift it was written in (an event id), if any. */
  shift: number | null;
};

export type Entry = EntrySummary & {
  body: string;
  reactions: Reactions;
  photos: Photo[];
  visibility: Visibility;
  readCount: number;
  buzzCount: number;
};

/** `member` is set when a signed-in reader wrote it: their avatar and desktop, and the name is theirs alone. */
export type Member = { avatar: string; handle: string } | null;
export type Note = {
  id: number;
  /** The note this one answers; replies are one level deep, so this is always a top-level note. */
  parentId: number | null;
  name: string;
  body: string;
  isAuthor: boolean;
  member: Member;
  reactions: Reactions;
  song: SongSticker | null;
  createdAt: string;
  /** Set when the writer changed it after posting. */
  editedAt: string | null;
};

/** A diary a member subscribed to: whose, and when they last wrote. */
export type Subscription = Author & { lastWroteAt: string | null };

/** One page as a star in the archive's sky: when it was written and how much it was answered. */
export type Star = {
  id: number;
  slug: string;
  title: string;
  mood: string;
  writtenAt: string;
  author: { handle: string; name: string };
  /** Notes and reactions together: how bright the star is. */
  glow: number;
  sealedUntil: string | null;
};

export type SearchResults = { people: Array<Author & { bio: string }>; pages: EntrySummary[] };
/** Which reaction this reader left, on the page and on each of its notes. */
export type MyReactions = { entry: ReactionKind | null; notes: Record<number, ReactionKind> };
export type Shout = {
  id: number;
  name: string;
  body: string;
  member: Member;
  song: SongSticker | null;
  createdAt: string;
};
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

/** Everything a member wrote, to take with them: what "Download my diary" packs into a zip. */
export type DiaryExport = {
  exportedAt: string;
  writer: { name: string; handle: string; bio: string; joinedAt: string; lastfm: string | null };
  pages: Array<{
    title: string;
    slug: string;
    body: string;
    mood: string;
    weather: string;
    writtenAt: string;
    visibility: Visibility;
    /** A sealed letter's opening time. */
    opensAt: string | null;
    song: { title: string; artist: string; url: string | null } | null;
    photos: Photo[];
    readCount: number;
    /** What readers left on the page (visible notes only), oldest first. */
    notes: Array<{ id: number; replyTo: number | null; name: string; body: string; at: string }>;
  }>;
  blasts: Array<{ body: string; at: string }>;
  almost: Array<{ body: string; at: string }>;
  guestbook: Array<{ name: string; body: string; at: string }>;
};

/* ---------- private messages ---------- */

/** Who to talk to: up to 11 others (a group holds 12), and a name if it is a group. */
export const startChatInput = z.object({
  with: z.array(z.string().trim().min(1).max(24)).min(1).max(11),
  title: z.string().trim().max(40).optional(),
});
export const chatMessageInput = z.object({ body: z.string().trim().min(1).max(1000) });
export const addToChatInput = z.object({ with: z.array(z.string().trim().min(1).max(24)).min(1).max(11) });
/** Block (or, with `on: false`, unblock) a member from messaging you. */
export const blockInput = z.object({ handle: z.string().trim().min(1).max(24), on: z.boolean() });

export type ChatMessage = {
  id: number;
  conversationId: number;
  /** Null for a system line, or once the writer deleted their account. */
  from: Author | null;
  kind: "text" | "buzz" | "system";
  body: string;
  createdAt: string;
};

export type Conversation = {
  id: number;
  /** A group's name (null for two people, who are named by the other person). */
  title: string | null;
  group: boolean;
  /** Everyone in it, the reader included. */
  members: Author[];
  last: ChatMessage | null;
  unread: number;
  lastMessageAt: string;
  /** Between two people: the reader has blocked the other one. */
  blocked: boolean;
};
