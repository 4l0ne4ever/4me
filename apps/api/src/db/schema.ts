import type { InkLook, InkState, Photo, SongSticker, Visibility } from "@4me/shared";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const entries = pgTable(
  "entries",
  {
    id: serial("id").primaryKey(),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    mood: text("mood").notNull().default(""),
    weather: text("weather").notNull().default(""),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
    songTitle: text("song_title"),
    songArtist: text("song_artist"),
    songUrl: text("song_url"),
    songEmbedUrl: text("song_embed_url"),
    songCoverUrl: text("song_cover_url"),
    songPreviewUrl: text("song_preview_url"),
    /** The music search id the song was picked by, so saving again needs no lookup. */
    songId: bigint("song_id", { mode: "number" }),
    photos: jsonb("photos").$type<Photo[]>().notNull().default([]),
    /** Title and body as search compares them (lower-case, no accents). */
    searchText: text("search_text").notNull().default(""),
    visibility: text("visibility").$type<Visibility>().notNull().default("public"),
    /** "hidden" by the site's moderator, or by enough reports; only the author still sees it. */
    status: text("status").$type<"visible" | "hidden">().notNull().default("visible"),
    /** The night whose question the page answers ("2026-10-22"). */
    prompt: text("prompt"),
    /** A sealed letter: nobody but its writer reads it before this moment. */
    opensAt: timestamp("opens_at", { withTimezone: true }),
    /** When the letter opened and its readers were told (so they are told once). */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    /** Written in a night shift: sealed until it ends, then opened with everyone else's. */
    eventId: integer("event_id").references((): AnyPgColumn => nightEvents.id, { onDelete: "set null" }),
    /** Reports made before this moment no longer count (the moderator looked and kept the page up). */
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    readCount: integer("read_count").notNull().default(0),
    buzzCount: integer("buzz_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entries_visibility_written_idx").on(t.visibility, t.writtenAt),
    index("entries_author_written_idx").on(t.authorId, t.writtenAt),
    uniqueIndex("entries_author_slug_idx").on(t.authorId, t.slug),
    index("entries_prompt_idx").on(t.prompt),
    index("entries_event_idx").on(t.eventId),
  ],
);

/** Readers with an account. Passwords are hashed with scrypt by the web server; only the hash is stored here. */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name").notNull(),
    nameKey: text("name_key").notNull(),
    /** The address of their desktop, /u/<handle>. */
    handle: text("handle").notNull(),
    bio: text("bio").notNull().default(""),
    /** Name and handle as search compares them. */
    searchName: text("search_name").notNull().default(""),
    lastfmUser: text("lastfm_user").notNull().default(""),
    status: text("status").$type<"active" | "suspended">().notNull().default("active"),
    passwordHash: text("password_hash"),
    avatar: text("avatar").notNull().default("pines"),
    /** Bumped to sign the person out everywhere (password change, reset, "log off everywhere"). */
    sessionVersion: integer("session_version").notNull().default(1),
    ink: jsonb("ink").$type<InkState>(),
    /** How they dressed their Ink: her name, colours and hat. */
    inkLook: jsonb("ink_look").$type<InkLook>(),
    /** Wants one morning email with the new pages from the diaries they subscribe to (verified addresses only). */
    emailDigest: boolean("email_digest").notNull().default(false),
    /** When that email last went out: the next one starts from here. */
    digestAt: timestamp("digest_at", { withTimezone: true }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_name_key_idx").on(t.nameKey),
    uniqueIndex("users_handle_idx").on(t.handle),
  ],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] }), index("oauth_user_idx").on(t.userId)],
);

/** Single-use, one-hour reset links. Only a SHA-256 of the token is kept. */
export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Single-use, one-day links that prove an address is the member's. Only a SHA-256 of the token is kept. */
export const emailChecks = pgTable("email_checks", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The address the link was sent to: it only proves that one. */
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    /** A reply's top-level note. Replies are one level deep; deleting a note deletes its replies. */
    parentId: integer("parent_id").references((): AnyPgColumn => notes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    isAuthor: boolean("is_author").notNull().default(false),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<"visible" | "hidden" | "pending">().notNull().default("visible"),
    ipHash: text("ip_hash"),
    /** A song stuck on the note. */
    song: jsonb("song").$type<SongSticker>(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notes_entry_created_idx").on(t.entryId, t.createdAt),
    index("notes_user_idx").on(t.userId),
    index("notes_parent_idx").on(t.parentId),
  ],
);

export const shouts = pgTable(
  "shouts",
  {
    id: serial("id").primaryKey(),
    /** The member whose guestbook this is; null for the shared one on the front desktop. */
    ownerId: integer("owner_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<"visible" | "hidden" | "pending">().notNull().default("visible"),
    ipHash: text("ip_hash"),
    /** A song stuck on the shout. */
    song: jsonb("song").$type<SongSticker>(),
    createdAt: createdAt(),
  },
  (t) => [index("shouts_created_idx").on(t.createdAt), index("shouts_owner_created_idx").on(t.ownerId, t.createdAt)],
);

export const blasts = pgTable("blasts", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const almost = pgTable("almost", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** One row per reader per page: a member ("u:<id>") or a guest (their hashed IP), so nobody counts twice. */
export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    reporter: text("reporter").notNull(),
    reason: text("reason").$type<"spam" | "hurtful" | "private" | "other">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reports_entry_reporter_idx").on(t.entryId, t.reporter)],
);

/** One report per reader per note; three different readers hide the note until the moderator looks. */
export const noteReports = pgTable(
  "note_reports",
  {
    id: serial("id").primaryKey(),
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    reporter: text("reporter").notNull(),
    reason: text("reason").$type<"spam" | "hurtful" | "private" | "other">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("note_reports_note_reporter_idx").on(t.noteId, t.reporter)],
);

/** Subscriptions to a diary, like a blog's: subscribers hear when it has a new page, and see it in their list. */
export const follows = pgTable(
  "follows",
  {
    followerId: integer("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: integer("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("follows_followee_idx").on(t.followeeId)],
);

/** One reaction per reader per page or note: a member ("u:<id>") or a guest (their hashed IP). */
export const reactions = pgTable(
  "reactions",
  {
    id: serial("id").primaryKey(),
    target: text("target").$type<"entry" | "note">().notNull(),
    targetId: integer("target_id").notNull(),
    reactor: text("reactor").notNull(),
    kind: text("kind").$type<"love" | "hug" | "haha" | "wow" | "sad" | "moon">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reactions_target_reactor_idx").on(t.target, t.targetId, t.reactor)],
);

/** Every photo a member uploaded, for their storage quota and to clean up after them. */
export const uploads = pgTable(
  "uploads",
  {
    key: text("key").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("uploads_user_idx").on(t.userId, t.createdAt)],
);

/** What happened on a member's pages while they were away (and as it happens): notes, shouts, BUZZes, replies. */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<"note" | "pending" | "reply" | "shout" | "buzz" | "reaction" | "post" | "opened">()
      .notNull(),
    text: text("text").notNull(),
    link: text("link").notNull(),
    actorName: text("actor_name"),
    actorAvatar: text("actor_avatar"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

/** Which YouTube video plays a song in full, looked up once per song. A null video means none was found. */
export const songVideos = pgTable("song_videos", {
  key: text("key").primaryKey(),
  videoId: text("video_id"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catStats = pgTable("cat_stats", {
  id: integer("id").primaryKey().default(1),
  pets: bigint("pets", { mode: "number" }).notNull().default(0),
  fish: bigint("fish", { mode: "number" }).notNull().default(0),
  plays: bigint("plays", { mode: "number" }).notNull().default(0),
});

export const rateHits = pgTable(
  "rate_hits",
  {
    key: text("key").notNull(),
    window: bigint("window", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.key, t.window] })],
);

/**
 * Private messages between members: two people, or a named group. A conversation between two people has a
 * `pairKey` ("smallerId:largerId"), so the same two always share one.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    /** A group's name; two people's conversation has none. */
    title: text("title"),
    isGroup: boolean("is_group").notNull().default(false),
    pairKey: text("pair_key"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversations_pair_idx").on(t.pairKey)],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Everything after this is unread for them. */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Null once its writer deleted their account: shown as "a former reader". */
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** "text" is a message, "buzz" a BUZZ!!!, "system" a line like "Lan added Khoa". */
    kind: text("kind").$type<"text" | "buzz" | "system">().notNull().default("text"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

/** Someone a member doesn't want messages from: neither can start a conversation with, or add, the other. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: integer("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: integer("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked_idx").on(t.blockedId)],
);

/**
 * What went wrong on the site, one row per kind of error: where (the API, the web server, a reader's browser), the
 * message, where in the code, and how often. Never the request's data: messages are cut before any query parameters.
 */
export const errorEvents = pgTable("error_events", {
  fingerprint: text("fingerprint").primaryKey(),
  source: text("source").$type<"api" | "web" | "browser">().notNull(),
  message: text("message").notNull(),
  detail: text("detail").notNull().default(""),
  path: text("path").notNull().default(""),
  count: integer("count").notNull().default(1),
  firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * People a writer keeps off their diary: no notes on their pages, no signing their guestbook. A member by their
 * account; a guest by the hashed IP their note came from. Separate from blocking someone in Messenger.
 */
export const diaryBans = pgTable(
  "diary_bans",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"),
    /** The name they wrote under, so the writer knows who is on their list. */
    label: text("label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("diary_bans_owner_user_idx").on(t.ownerId, t.userId),
    uniqueIndex("diary_bans_owner_ip_idx").on(t.ownerId, t.ipHash),
  ],
);

/** Tonight's shared poem: everyone adds one line a night, and in the morning it reads as one piece. */
export const nightLines = pgTable(
  "night_lines",
  {
    id: serial("id").primaryKey(),
    /** The evening's date in Vietnam ("2026-10-22"). */
    night: text("night").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    name: text("name").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<"visible" | "hidden">().notNull().default("visible"),
    createdAt: createdAt(),
  },
  (t) => [
    index("night_lines_night_idx").on(t.night, t.createdAt),
    uniqueIndex("night_lines_night_user_idx").on(t.night, t.userId),
    uniqueIndex("night_lines_night_ip_idx").on(t.night, t.ipHash),
  ],
);

/** A night the moderator hosts: a line on everyone's desktop, perhaps its own question, perhaps a night shift. */
export const nightEvents = pgTable(
  "night_events",
  {
    id: serial("id").primaryKey(),
    /** The evening's date in Vietnam; one event a night. */
    night: text("night").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    question: text("question"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    shift: boolean("shift").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("night_events_night_idx").on(t.night)],
);
