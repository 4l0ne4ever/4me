import type { InkState, Photo, Visibility } from "@4me/shared";
import {
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
    slug: text("slug").notNull().unique(),
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
    photos: jsonb("photos").$type<Photo[]>().notNull().default([]),
    visibility: text("visibility").$type<Visibility>().notNull().default("public"),
    readCount: integer("read_count").notNull().default(0),
    buzzCount: integer("buzz_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entries_visibility_written_idx").on(t.visibility, t.writtenAt)],
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
    passwordHash: text("password_hash"),
    avatar: text("avatar").notNull().default("pines"),
    /** Bumped to sign the person out everywhere (password change, reset, "log off everywhere"). */
    sessionVersion: integer("session_version").notNull().default(1),
    ink: jsonb("ink").$type<InkState>(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_name_key_idx").on(t.nameKey)],
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

export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    isAuthor: boolean("is_author").notNull().default(false),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<"visible" | "hidden" | "pending">().notNull().default("visible"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("notes_entry_created_idx").on(t.entryId, t.createdAt), index("notes_user_idx").on(t.userId)],
);

export const shouts = pgTable(
  "shouts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<"visible" | "hidden" | "pending">().notNull().default("visible"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("shouts_created_idx").on(t.createdAt)],
);

export const blasts = pgTable("blasts", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const almost = pgTable("almost", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
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
