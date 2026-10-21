import {
  AVATARS,
  type AvatarId,
  almostInput,
  blastInput,
  displayName,
  editNoteInput,
  email,
  entryInput,
  handleFrom,
  handle as handleSchema,
  type InboxNote,
  inkState,
  type Me,
  type MyEntry,
  memberNoteInput,
  memberReactInput,
  memberShoutInput,
  moderationInput,
  nameKey,
  profileInput,
  reportReason,
  type Subscription,
  searchable,
} from "@4me/shared";
import { and, desc, eq, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  almost,
  blasts,
  entries,
  follows,
  notes,
  notifications,
  oauthAccounts,
  passwordResets,
  reactions,
  shouts,
  uploads,
  users,
} from "../db/schema";
import type { AppEnv } from "../env";
import {
  authorCols,
  dropUnusedPhotos,
  entryValues,
  fileNoteReport,
  fileReport,
  isReadable,
  isUniqueViolation,
  noteCount,
  origin,
  photoKeys,
  positiveId,
  readableEntry,
  threadOf,
} from "../lib/entries";
import { diaryExport } from "../lib/export";
import { allow, allowKey, humanCheck, isReservedName, looksLikeSpam, sameSecret, sha256 } from "../lib/guard";
import { isSealed, toAlmost, toAuthor, toBlast, toEntry, toNote, toShout, toSummary } from "../lib/map";
import { notify, publish, quote, recentNotifications } from "../lib/notify";
import { countsFor, dropReactions, mine, react } from "../lib/reactions";
import { json } from "../lib/validate";
import { activeMember } from "./social";

// Account storage for the web server. Every route needs the server token; browsers never reach these.
// Passwords arrive already hashed (scrypt, done by the web server) and are never logged or returned to a browser.

const hash = z
  .string()
  .regex(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$/, "not a password hash")
  .max(400);
const AVATAR_IDS = AVATARS.map((a) => a.id) as string[];

type UserRow = typeof users.$inferSelect;

async function toMe(c: Context<AppEnv>, u: UserRow): Promise<Me & { sessionVersion: number }> {
  const [g] = await c
    .get("db")
    .select({ id: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, u.id), eq(oauthAccounts.provider, "google")))
    .limit(1);
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    bio: u.bio,
    lastfmUser: u.lastfmUser,
    suspended: u.status !== "active",
    email: u.email,
    avatar: (AVATAR_IDS.includes(u.avatar) ? u.avatar : "pines") as AvatarId,
    hasPassword: Boolean(u.passwordHash),
    google: Boolean(g),
    ink: u.ink ?? null,
    createdAt: u.createdAt.toISOString(),
    sessionVersion: u.sessionVersion,
  };
}

const userId = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function loadUser(c: Context<AppEnv>, raw: string): Promise<UserRow | null> {
  const id = userId(raw);
  if (!id) return null;
  const [u] = await c.get("db").select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

const noteAuthor = alias(users, "note_author");

/** The member behind the request, if they may write. Suspended members get a plain refusal. */
async function writer(c: Context<AppEnv>): Promise<UserRow | Response> {
  const u = await loadUser(c, c.req.param("id") ?? "");
  if (!u) return c.json({ error: "not found" }, 404);
  if (u.status !== "active") return c.json({ error: "this account can't post right now" }, 403);
  return u;
}

/** One of the member's own pages, any visibility. Everything else is "not found", even someone else's page. */
async function ownEntry(c: Context<AppEnv>, opts: { write?: boolean } = {}) {
  const u = opts.write ? await writer(c) : await loadUser(c, c.req.param("id") ?? "");
  if (u instanceof Response) return u;
  if (!u) return c.json({ error: "not found" }, 404);
  const entryId = positiveId(c.req.param("entryId"));
  if (!entryId) return c.json({ error: "not found" }, 404);
  const [row] = await c
    .get("db")
    .select({ e: entries, a: authorCols })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(eq(entries.id, entryId), eq(entries.authorId, u.id)))
    .limit(1);
  return row ? { u, ...row } : c.json({ error: "not found" }, 404);
}

async function nameFree(c: Context<AppEnv>, name: string, exceptId?: number): Promise<boolean> {
  if (isReservedName(name)) return false;
  const [hit] = await c
    .get("db")
    .select({ id: users.id })
    .from(users)
    .where(eq(users.nameKey, nameKey(name)))
    .limit(1);
  return !hit || hit.id === exceptId;
}

/** "Wren" -> "Wren", "Wren 2", "Wren 3"… for Google sign-ups whose name is already taken. */
async function freeNameLike(c: Context<AppEnv>, wanted: string): Promise<string> {
  const base =
    (displayName.safeParse(wanted).success ? wanted : wanted.replace(/[^\p{L}\p{N} ._-]/gu, "").trim()).slice(0, 20) ||
    "reader";
  const start = displayName.safeParse(base).success ? base : `reader ${base}`.slice(0, 20);
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? start : `${start} ${i}`;
    if (displayName.safeParse(candidate).success && (await nameFree(c, candidate))) return candidate;
  }
  return `reader ${crypto.randomUUID().slice(0, 8)}`;
}

async function handleFree(c: Context<AppEnv>, handle: string, exceptId?: number): Promise<boolean> {
  const [hit] = await c.get("db").select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1);
  return !hit || hit.id === exceptId;
}

/** "Đêm mưa" -> "dem_mua", then "dem_mua2", "dem_mua3"… until one is free. */
async function freeHandleLike(c: Context<AppEnv>, name: string): Promise<string> {
  const base = handleFrom(name);
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 20 - String(i).length)}${i}`;
    if (handleSchema.safeParse(candidate).success && (await handleFree(c, candidate))) return candidate;
  }
  return `reader_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function uniqueField(e: unknown): "email" | "name" | "handle" | null {
  const err = e as {
    code?: string;
    constraint?: string;
    message?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return null;
  const where = `${err?.constraint ?? err?.cause?.constraint ?? ""} ${err?.message ?? ""}`;
  return where.includes("email") ? "email" : where.includes("handle") ? "handle" : "name";
}

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const internalRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !(await sameSecret(token, c.env.ADMIN_TOKEN))) return c.json({ error: "unauthorised" }, 401);
    const ip = c.req.header("x-client-ip");
    if (ip && /^[0-9a-fA-F:.]{2,64}$/.test(ip)) c.set("clientIp", ip);
    await next();
  })

  /* ---------- sign up, sign in ---------- */
  .post(
    "/users",
    json(z.object({ email, displayName, passwordHash: hash, turnstileToken: z.string().max(2048).optional() })),
    async (c) => {
      const input = c.req.valid("json");
      if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
      if (!(await allow(c, "register", 5, 3600)))
        return c.json({ error: "too many new accounts from here, try later" }, 429);
      if (!(await nameFree(c, input.displayName)))
        return c.json({ error: "that name is taken", field: "displayName" }, 409);
      try {
        const [u] = await c
          .get("db")
          .insert(users)
          .values(
            await (async () => {
              const handle = await freeHandleLike(c, input.displayName);
              return {
                email: input.email,
                displayName: input.displayName,
                nameKey: nameKey(input.displayName),
                handle,
                searchName: searchable(`${input.displayName} ${handle}`),
                passwordHash: input.passwordHash,
              };
            })(),
          )
          .returning();
        return c.json(await toMe(c, u!), 201);
      } catch (e) {
        const field = uniqueField(e);
        // Sign-up has to say the address is in use; the per-IP limit above keeps that from being used to probe.
        if (field === "email")
          return c.json({ error: "an account with that email already exists", field: "email" }, 409);
        if (field === "name") return c.json({ error: "that name is taken", field: "displayName" }, 409);
        if (field === "handle") return c.json({ error: "try again in a moment" }, 409);
        throw e;
      }
    },
  )
  .post("/sign-in", json(z.object({ email })), async (c) => {
    const { email: address } = c.req.valid("json");
    // Two limits: per address (stops guessing one account's password) and per IP (stops spraying many accounts).
    const okIp = await allow(c, "signin", 30, 900);
    const okEmail = await allowKey(c, `signin-email:${(await sha256(address)).slice(0, 32)}`, 10, 900);
    if (!okIp || !okEmail) return c.json({ error: "too many attempts, wait 15 minutes and try again" }, 429);
    const [u] = await c.get("db").select().from(users).where(eq(users.email, address)).limit(1);
    if (!u?.passwordHash) return c.json({ user: null });
    return c.json({ user: { id: u.id, passwordHash: u.passwordHash, sessionVersion: u.sessionVersion } });
  })
  .post(
    "/oauth/google",
    json(
      z.object({
        sub: z.string().min(1).max(255),
        email: email.nullable(),
        emailVerified: z.boolean(),
        name: z.string().max(200).default(""),
      }),
    ),
    async (c) => {
      const g = c.req.valid("json");
      const db = c.get("db");
      const [linked] = await db
        .select({ u: users })
        .from(oauthAccounts)
        .innerJoin(users, eq(users.id, oauthAccounts.userId))
        .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerUserId, g.sub)))
        .limit(1);
      if (linked) return c.json(await toMe(c, linked.u));

      // Link to an existing account only when Google says it has verified the address.
      if (g.email && g.emailVerified) {
        const [existing] = await db.select().from(users).where(eq(users.email, g.email)).limit(1);
        if (existing) {
          await db.insert(oauthAccounts).values({ provider: "google", providerUserId: g.sub, userId: existing.id });
          if (!existing.emailVerified)
            await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id));
          return c.json(await toMe(c, existing));
        }
      }
      if (!(await allow(c, "register", 5, 3600)))
        return c.json({ error: "too many new accounts from here, try later" }, 429);
      const name = await freeNameLike(c, g.name || g.email?.split("@")[0] || "reader");
      const [u] = await db
        .insert(users)
        .values({
          email: g.email && g.emailVerified ? g.email : null,
          emailVerified: Boolean(g.email && g.emailVerified),
          displayName: name,
          nameKey: nameKey(name),
          ...(await (async () => {
            const handle = await freeHandleLike(c, name);
            return { handle, searchName: searchable(`${name} ${handle}`) };
          })()),
        })
        .returning();
      await db.insert(oauthAccounts).values({ provider: "google", providerUserId: g.sub, userId: u!.id });
      return c.json(await toMe(c, u!), 201);
    },
  )

  /* ---------- the signed-in reader ---------- */
  .get("/users/:id", async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    return u ? c.json(await toMe(c, u)) : c.json({ error: "not found" }, 404);
  })
  .patch("/users/:id", json(profileInput.extend({ ink: inkState.optional() })), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    const input = c.req.valid("json");
    const set: Partial<typeof users.$inferInsert> = {};
    if (input.displayName && input.displayName !== u.displayName) {
      if (!(await nameFree(c, input.displayName, u.id)))
        return c.json({ error: "that name is taken", field: "displayName" }, 409);
      set.displayName = input.displayName;
      set.nameKey = nameKey(input.displayName);
    }
    if (input.handle && input.handle !== u.handle) {
      if (!(await handleFree(c, input.handle, u.id)))
        return c.json({ error: "that address is taken", field: "handle" }, 409);
      set.handle = input.handle;
    }
    if (input.bio !== undefined) set.bio = input.bio;
    if (input.lastfmUser !== undefined) set.lastfmUser = input.lastfmUser;
    if (input.avatar) set.avatar = input.avatar;
    if (input.ink) set.ink = input.ink;
    if (set.displayName || set.handle)
      set.searchName = searchable(`${set.displayName ?? u.displayName} ${set.handle ?? u.handle}`);
    if (Object.keys(set).length === 0) return c.json(await toMe(c, u));
    try {
      const [next] = await c.get("db").update(users).set(set).where(eq(users.id, u.id)).returning();
      return c.json(await toMe(c, next!));
    } catch (e) {
      const field = uniqueField(e);
      if (field === "handle") return c.json({ error: "that address is taken", field: "handle" }, 409);
      if (field) return c.json({ error: "that name is taken", field: "displayName" }, 409);
      throw e;
    }
  })
  .post("/users/:id/password", json(z.object({ passwordHash: hash })), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    const [next] = await c
      .get("db")
      .update(users)
      .set({ passwordHash: c.req.valid("json").passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id))
      .returning({ sessionVersion: users.sessionVersion });
    await c.get("db").delete(passwordResets).where(eq(passwordResets.userId, u.id));
    return c.json(next);
  })
  .post("/users/:id/sign-out-everywhere", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const [next] = await c
      .get("db")
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, id))
      .returning({ sessionVersion: users.sessionVersion });
    return next ? c.json(next) : c.json({ error: "not found" }, 404);
  })
  .delete("/users/:id", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    // Their photos go first, while the list of what they uploaded still exists.
    const files = await db.select({ key: uploads.key }).from(uploads).where(eq(uploads.userId, id));
    await Promise.allSettled(files.map((f) => c.get("media")?.delete(f.key)));
    // Their reactions go; their notes on other people's pages stay, unsigned. Their own pages go with them.
    await db.delete(reactions).where(eq(reactions.reactor, `u:${id}`));
    await db.update(notes).set({ name: "a former reader" }).where(eq(notes.userId, id));
    await db.update(shouts).set({ name: "a former reader" }).where(eq(shouts.userId, id));
    const [gone] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return gone ? c.json({ deleted: gone.id }) : c.json({ error: "not found" }, 404);
  })
  .get("/users/:id/notes", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const rows = await c
      .get("db")
      .select({ n: notes, slug: entries.slug, title: entries.title, handle: users.handle })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(eq(notes.userId, id))
      .orderBy(desc(notes.createdAt))
      .limit(100);
    return c.json(
      rows.map((r) => ({
        id: r.n.id,
        body: r.n.body,
        createdAt: r.n.createdAt.toISOString(),
        handle: r.handle,
        slug: r.slug,
        title: r.title,
        status: r.n.status,
      })),
    );
  })

  /* ---------- members write under their own name ---------- */
  .post("/users/:id/notes/:entryId", json(memberNoteInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    if (!(await allowKey(c, `member-note:${u.id}`, 10, 600)))
      return c.json({ error: "slow down a little, try again soon" }, 429);
    const entryId = positiveId(c.req.param("entryId"));
    const entry = entryId ? await readableEntry(c, entryId) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    const { body, parentId } = c.req.valid("json");
    const thread = parentId ? await threadOf(c, entry.id, parentId) : null;
    if (parentId && !thread) return c.json({ error: "that note is gone" }, 404);
    // The page's own author answering on it is marked, and never held for review.
    const isAuthor = entry.authorId === u.id;
    const status = !isAuthor && looksLikeSpam(body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(notes)
      .values({
        entryId: entry.id,
        parentId: thread?.id ?? null,
        userId: u.id,
        name: u.displayName,
        body,
        status,
        isAuthor,
      })
      .returning();
    const note = toNote(row!, u);
    if (status === "visible") publish(c, [`entry:${entry.id}`, "notes"], { type: "note", entryId: entry.id, note });
    const link = `/u/${entry.handle}/${entry.slug}`;
    const actor = { name: u.displayName, avatar: u.avatar };
    const told = new Set<number>([u.id]);
    if (thread?.userId && !told.has(thread.userId) && status === "visible") {
      told.add(thread.userId);
      await notify(c, thread.userId, {
        kind: "reply",
        text: `${u.displayName} replied to your note on ${quote(entry.title)}`,
        link,
        actor,
      });
    }
    if (isAuthor && !thread) {
      // The writer answered on their own page: everyone signed in who left a note there hears about it.
      const others = await c
        .get("db")
        .selectDistinct({ userId: notes.userId })
        .from(notes)
        .where(and(eq(notes.entryId, entry.id), ne(notes.userId, u.id), eq(notes.status, "visible")));
      for (const o of others.slice(0, 50))
        if (o.userId && !told.has(o.userId)) {
          told.add(o.userId);
          await notify(c, o.userId, {
            kind: "reply",
            text: `${u.displayName} replied on ${quote(entry.title)}`,
            link,
            actor,
          });
        }
    } else if (!told.has(entry.authorId)) {
      await notify(c, entry.authorId, {
        kind: status === "pending" ? "pending" : "note",
        text:
          status === "pending"
            ? `A note from ${u.displayName} on ${quote(entry.title)} is waiting for you`
            : `${u.displayName} left a note on ${quote(entry.title)}`,
        link,
        actor,
      });
    }
    return c.json({ note, pending: status === "pending" }, 201);
  })
  /** The note's own writer, or the page's writer, may delete it; its replies go with it. */
  .delete("/users/:id/notes/:noteId", async (c) => {
    const id = userId(c.req.param("id"));
    const noteId = positiveId(c.req.param("noteId"));
    if (!id || !noteId) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    const [row] = await db
      .select({ id: notes.id, entryId: notes.entryId, userId: notes.userId, authorId: entries.authorId })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .where(eq(notes.id, noteId))
      .limit(1);
    if (!row || (row.userId !== id && row.authorId !== id)) return c.json({ error: "not found" }, 404);
    const replies = await db.select({ id: notes.id }).from(notes).where(eq(notes.parentId, noteId));
    await db.delete(notes).where(eq(notes.id, noteId));
    await dropReactions(c, "note", [noteId, ...replies.map((r) => r.id)]);
    publish(c, [`entry:${row.entryId}`, "notes"], { type: "note-gone", entryId: row.entryId, noteId });
    return c.json({ deleted: noteId });
  })
  /** The note's writer edits it. A link added later sends it back for approval, like a new note with one. */
  .patch("/users/:id/notes/:noteId", json(editNoteInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    const noteId = positiveId(c.req.param("noteId"));
    if (!noteId) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    const [mine] = await db
      .select({ n: notes, authorId: entries.authorId })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .where(and(eq(notes.id, noteId), eq(notes.userId, u.id)))
      .limit(1);
    if (!mine) return c.json({ error: "not found" }, 404);
    const { body } = c.req.valid("json");
    const held = mine.authorId !== u.id && looksLikeSpam(body);
    const [row] = await db
      .update(notes)
      .set({ body, editedAt: new Date(), ...(held ? { status: "pending" as const } : {}) })
      .where(eq(notes.id, noteId))
      .returning();
    const counts = (await countsFor(c, "note", [noteId])).get(noteId);
    const note = toNote(row!, u, counts);
    if (row!.status === "visible")
      publish(c, [`entry:${row!.entryId}`, "notes"], { type: "note", entryId: row!.entryId, note });
    else publish(c, [`entry:${row!.entryId}`, "notes"], { type: "note-gone", entryId: row!.entryId, noteId });
    return c.json({ note, pending: row!.status !== "visible" });
  })
  .post("/users/:id/reports/notes/:noteId", json(z.object({ reason: reportReason })), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `member-report:${u.id}`, 20, 3600)))
      return c.json({ error: "too many reports, try later" }, 429);
    const noteId = positiveId(c.req.param("noteId"));
    const [own] = noteId
      ? await c
          .get("db")
          .select({ id: notes.id })
          .from(notes)
          .where(and(eq(notes.id, noteId), eq(notes.userId, u.id)))
      : [];
    if (own) return c.json({ error: "that's your own note" }, 400);
    const done = noteId ? await fileNoteReport(c, noteId, `u:${u.id}`, c.req.valid("json").reason) : null;
    if (!done) return c.json({ error: "not found" }, 404);
    if (done.hidden)
      publish(c, [`entry:${done.entryId}`, "notes"], { type: "note-gone", entryId: done.entryId, noteId: noteId! });
    return c.json({ ok: true });
  })

  /* ---------- subscriptions: following a diary, like a blog ---------- */
  .post("/users/:id/subscriptions/:handle", async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    const them = await activeMember(c, c.req.param("handle"));
    if (!them) return c.json({ error: "not found" }, 404);
    if (them.id === u.id) return c.json({ error: "that's your own diary" }, 400);
    if (!(await allowKey(c, `subscribe:${u.id}`, 60, 3600))) return c.json({ error: "slow down a little" }, 429);
    await c.get("db").insert(follows).values({ followerId: u.id, followeeId: them.id }).onConflictDoNothing();
    return c.json({ ok: true });
  })
  .delete("/users/:id/subscriptions/:handle", async (c) => {
    const id = userId(c.req.param("id"));
    const them = await activeMember(c, c.req.param("handle"));
    if (!id || !them) return c.json({ error: "not found" }, 404);
    await c
      .get("db")
      .delete(follows)
      .where(and(eq(follows.followerId, id), eq(follows.followeeId, them.id)));
    return c.json({ ok: true });
  })
  /** The diaries this member subscribed to, the ones that wrote most recently first. */
  .get("/users/:id/subscriptions", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const rows = await c
      .get("db")
      .select({
        handle: users.handle,
        name: users.displayName,
        avatar: users.avatar,
        lastWroteAt: sql<
          string | null
        >`(select max(e."written_at") from "entries" e where e."author_id" = "users"."id" and e."visibility" = 'public' and e."status" = 'visible')`,
      })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followeeId))
      .where(and(eq(follows.followerId, id), eq(users.status, "active")))
      .limit(500);
    const subscriptions: Subscription[] = rows
      .map((r) => ({ ...toAuthor(r), lastWroteAt: r.lastWroteAt ? new Date(r.lastWroteAt).toISOString() : null }))
      .sort((a, b) => (b.lastWroteAt ?? "").localeCompare(a.lastWroteAt ?? ""));
    return c.json(subscriptions);
  })
  /** Pages from the diaries this member subscribed to, newest first: their reading list. */
  .get("/users/:id/feed", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const before = c.req.query("before");
    const beforeDate = before ? new Date(before) : null;
    const rows = await c
      .get("db")
      .select({ e: entries, a: authorCols, noteCount })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .innerJoin(follows, and(eq(follows.followeeId, entries.authorId), eq(follows.followerId, id)))
      .where(
        and(
          isReadable,
          beforeDate && !Number.isNaN(beforeDate.getTime()) ? lt(entries.writtenAt, beforeDate) : undefined,
        ),
      )
      .orderBy(desc(entries.writtenAt))
      .limit(30);
    return c.json(rows.map((r) => toSummary({ ...r.e, noteCount: r.noteCount }, r.a, origin(c))));
  })

  /** A member reacts to a page or a note, counted once per account. */
  .post("/users/:id/react", json(memberReactInput), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `member-react:${u.id}`, 60, 600))) return c.json({ error: "slow down a little" }, 429);
    const { target, targetId, kind } = c.req.valid("json");
    const counts = await react(c, target, targetId, `u:${u.id}`, kind, {
      name: u.displayName,
      avatar: u.avatar,
      userId: u.id,
    });
    return counts ? c.json({ reactions: counts }) : c.json({ error: "not found" }, 404);
  })
  .get("/users/:id/reactions", async (c) => {
    const id = userId(c.req.param("id"));
    const entryId = positiveId(c.req.query("entry"));
    if (!id || !entryId) return c.json({ entry: null, notes: {} });
    return c.json(await mine(c, `u:${id}`, entryId));
  })
  .post("/users/:id/shouts", json(memberShoutInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    if (!(await allowKey(c, `member-shout:${u.id}`, 10, 600)))
      return c.json({ error: "slow down a little, try again soon" }, 429);
    const { body, owner: ownerHandle } = c.req.valid("json");
    const owner = await activeMember(c, ownerHandle);
    if (!owner) return c.json({ error: "not found" }, 404);
    const status = owner.id !== u.id && looksLikeSpam(body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(shouts)
      .values({ ownerId: owner.id, userId: u.id, name: u.displayName, body, status })
      .returning();
    const shout = toShout(row!, u);
    if (status === "visible") publish(c, [`guest:${owner.handle}`], { type: "shout", owner: owner.handle, shout });
    if (owner.id !== u.id)
      await notify(c, owner.id, {
        kind: "shout",
        text: `${u.displayName} signed your guestbook${status === "pending" ? " (waiting for approval)" : ""}`,
        link: `/u/${owner.handle}?open=guest`,
        actor: { name: u.displayName, avatar: u.avatar },
      });
    return c.json({ shout, pending: status === "pending" }, 201);
  })
  .post("/users/:id/reports/:entryId", json(z.object({ reason: reportReason })), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `member-report:${u.id}`, 20, 3600)))
      return c.json({ error: "too many reports, try later" }, 429);
    const entryId = positiveId(c.req.param("entryId"));
    const entry = entryId ? await readableEntry(c, entryId) : null;
    if (!entry) return c.json({ error: "not found" }, 404);
    if (entry.authorId === u.id) return c.json({ error: "that's your own page" }, 400);
    await fileReport(c, entry.id, `u:${u.id}`, c.req.valid("json").reason);
    return c.json({ ok: true });
  })

  /* ---------- a member's own pages ---------- */
  .get("/users/:id/entries", async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json([]);
    const rows = await c
      .get("db")
      .select({ e: entries, noteCount })
      .from(entries)
      .where(eq(entries.authorId, u.id))
      .orderBy(desc(entries.writtenAt))
      .limit(500);
    const mine: MyEntry[] = rows.map((r) => ({
      id: r.e.id,
      slug: r.e.slug,
      title: r.e.title,
      visibility: r.e.visibility,
      status: r.e.status,
      writtenAt: r.e.writtenAt.toISOString(),
      noteCount: r.noteCount,
    }));
    return c.json(mine);
  })
  .get("/users/:id/entries/:entryId", async (c) => {
    const own = await ownEntry(c);
    if (own instanceof Response) return own;
    return c.json({ ...toEntry(own.e, own.a, origin(c), {}, true), songId: own.e.songId });
  })
  .post("/users/:id/entries", json(entryInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    if (!(await allowKey(c, `entry:${u.id}`, 10, 86400)))
      return c.json({ error: "that's ten pages today already, the rest can wait for tomorrow" }, 429);
    const made = await entryValues(c, u.id, c.req.valid("json"));
    if ("problem" in made) return c.json({ error: made.problem }, made.status);
    try {
      const [row] = await c
        .get("db")
        .insert(entries)
        .values({ ...made.values, authorId: u.id })
        .returning();
      const author = { handle: u.handle, name: u.displayName, avatar: u.avatar };
      // A sealed letter is announced on the day it opens, not now.
      if (row!.visibility === "public" && !isSealed(row!)) {
        publish(c, ["tonight"], { type: "entry", entry: toSummary(row!, author, origin(c)) });
        // Subscribers hear about a new page, the way a blog emails its readers.
        const readers = await c
          .get("db")
          .select({ id: follows.followerId })
          .from(follows)
          .where(eq(follows.followeeId, u.id))
          .limit(1000);
        for (const r of readers)
          await notify(c, r.id, {
            kind: "post",
            text: `${u.displayName} wrote a new page: ${quote(row!.title)}`,
            link: `/u/${u.handle}/${row!.slug}`,
            actor: { name: u.displayName, avatar: u.avatar },
          });
      }
      return c.json(toEntry(row!, author, origin(c), {}, true), 201);
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: "you already have a page at that address", field: "slug" }, 409);
      throw e;
    }
  })
  .put("/users/:id/entries/:entryId", json(entryInput), async (c) => {
    const own = await ownEntry(c, { write: true });
    if (own instanceof Response) return own;
    const made = await entryValues(c, own.u.id, c.req.valid("json"), own.e);
    if ("problem" in made) return c.json({ error: made.problem }, made.status);
    try {
      const [row] = await c.get("db").update(entries).set(made.values).where(eq(entries.id, own.e.id)).returning();
      await dropUnusedPhotos(c, own.u.id, photoKeys(own.e.photos));
      return c.json(toEntry(row!, own.a, origin(c), {}, true));
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: "you already have a page at that address", field: "slug" }, 409);
      throw e;
    }
  })
  .delete("/users/:id/entries/:entryId", async (c) => {
    const own = await ownEntry(c);
    if (own instanceof Response) return own;
    const db = c.get("db");
    const onIt = await db.select({ id: notes.id }).from(notes).where(eq(notes.entryId, own.e.id));
    await db.delete(entries).where(eq(entries.id, own.e.id));
    await dropReactions(c, "entry", [own.e.id]);
    await dropReactions(
      c,
      "note",
      onIt.map((n) => n.id),
    );
    await dropUnusedPhotos(c, own.u.id, photoKeys(own.e.photos));
    return c.json({ deleted: own.e.id });
  })
  .get("/users/:id/blasts", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const rows = await c
      .get("db")
      .select()
      .from(blasts)
      .where(eq(blasts.authorId, id))
      .orderBy(desc(blasts.createdAt))
      .limit(50);
    return c.json(rows.map(toBlast));
  })
  .post("/users/:id/blasts", json(blastInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    if (!(await allowKey(c, `blast:${u.id}`, 30, 86400))) return c.json({ error: "enough blasts for today" }, 429);
    const [row] = await c
      .get("db")
      .insert(blasts)
      .values({ authorId: u.id, body: c.req.valid("json").body })
      .returning();
    return c.json(toBlast(row!), 201);
  })
  .delete("/users/:id/blasts/:blastId", async (c) => {
    const id = userId(c.req.param("id"));
    const blastId = positiveId(c.req.param("blastId"));
    if (!id || !blastId) return c.json({ error: "not found" }, 404);
    const [gone] = await c
      .get("db")
      .delete(blasts)
      .where(and(eq(blasts.id, blastId), eq(blasts.authorId, id)))
      .returning({ id: blasts.id });
    return gone ? c.json({ deleted: gone.id }) : c.json({ error: "not found" }, 404);
  })
  .get("/users/:id/almost", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const rows = await c
      .get("db")
      .select()
      .from(almost)
      .where(eq(almost.authorId, id))
      .orderBy(desc(almost.deletedAt))
      .limit(100);
    return c.json(rows.map(toAlmost));
  })
  .post("/users/:id/almost", json(almostInput), async (c) => {
    const u = await writer(c);
    if (u instanceof Response) return u;
    if (!(await allowKey(c, `almost:${u.id}`, 30, 86400))) return c.json({ error: "the bin is full for today" }, 429);
    const input = c.req.valid("json");
    const [row] = await c
      .get("db")
      .insert(almost)
      .values({ authorId: u.id, body: input.body, deletedAt: input.deletedAt ? new Date(input.deletedAt) : new Date() })
      .returning();
    return c.json(toAlmost(row!), 201);
  })
  .delete("/users/:id/almost/:almostId", async (c) => {
    const id = userId(c.req.param("id"));
    const almostId = positiveId(c.req.param("almostId"));
    if (!id || !almostId) return c.json({ error: "not found" }, 404);
    const [gone] = await c
      .get("db")
      .delete(almost)
      .where(and(eq(almost.id, almostId), eq(almost.authorId, id)))
      .returning({ id: almost.id });
    return gone ? c.json({ deleted: gone.id }) : c.json({ error: "not found" }, 404);
  })
  /** Notes other people left on this member's pages, newest first, the ones waiting for approval included. */
  .get("/users/:id/inbox", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json([]);
    const rows = await c
      .get("db")
      .select({ n: notes, title: entries.title, m: { avatar: noteAuthor.avatar, handle: noteAuthor.handle } })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .leftJoin(noteAuthor, eq(noteAuthor.id, notes.userId))
      .where(and(eq(entries.authorId, id), eq(notes.isAuthor, false)))
      .orderBy(desc(notes.createdAt))
      .limit(100);
    const inbox: InboxNote[] = rows.map((r) => ({
      ...toNote(r.n, r.m),
      entryId: r.n.entryId,
      title: r.title,
      status: r.n.status,
    }));
    return c.json(inbox);
  })
  .patch("/users/:id/inbox/:noteId", json(moderationInput), async (c) => {
    const id = userId(c.req.param("id"));
    const noteId = positiveId(c.req.param("noteId"));
    if (!id || !noteId) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    const [mine] = await db
      .select({ id: notes.id })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .where(and(eq(notes.id, noteId), eq(entries.authorId, id)))
      .limit(1);
    if (!mine) return c.json({ error: "not found" }, 404);
    const [row] = await db
      .update(notes)
      .set({ status: c.req.valid("json").status })
      .where(eq(notes.id, noteId))
      .returning();
    // A note just let through appears for everyone reading the page.
    if (row?.status === "visible") {
      const [m] = row.userId
        ? await db.select({ avatar: users.avatar, handle: users.handle }).from(users).where(eq(users.id, row.userId))
        : [];
      publish(c, [`entry:${row.entryId}`, "notes"], { type: "note", entryId: row.entryId, note: toNote(row, m) });
    }
    return c.json({ ok: true });
  })

  /* ---------- sealed letters ---------- */
  /**
   * Letters whose day has come: told to their readers once. Run every few minutes by the Worker's cron (and by the
   * dev server's timer). The words were already readable the moment the day came; this only sends the news.
   */
  .post("/letters/open", async (c) => {
    const db = c.get("db");
    const due = await db
      .select({ e: entries, a: authorCols, authorId: users.id })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, isNull(entries.openedAt), lte(entries.opensAt, sql`now()`)))
      .limit(50);
    for (const { e, a, authorId } of due) {
      const [claimed] = await db
        .update(entries)
        .set({ openedAt: new Date() })
        .where(and(eq(entries.id, e.id), isNull(entries.openedAt)))
        .returning({ id: entries.id });
      if (!claimed) continue; // another run got it
      publish(c, ["tonight"], { type: "entry", entry: toSummary(e, a, origin(c)) });
      const link = `/u/${a.handle}/${e.slug}`;
      await notify(c, authorId, { kind: "opened", text: `Your sealed letter ${quote(e.title)} just opened`, link });
      const readers = await db
        .select({ id: follows.followerId })
        .from(follows)
        .where(eq(follows.followeeId, authorId))
        .limit(1000);
      for (const r of readers)
        await notify(c, r.id, {
          kind: "opened",
          text: `${a.name}'s sealed letter just opened: ${quote(e.title)}`,
          link,
          actor: { name: a.name, avatar: a.avatar },
        });
    }
    return c.json({ opened: due.length });
  })

  /* ---------- notifications ---------- */
  .get("/users/:id/notifications", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json({ items: [], unread: 0 });
    const [{ n } = { n: 0 }] = await c
      .get("db")
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, id), isNull(notifications.readAt)));
    return c.json({ items: await recentNotifications(c, id), unread: n });
  })
  /** Marks the given notifications read, or all of them when no ids are given. */
  .post(
    "/users/:id/notifications/read",
    json(z.object({ ids: z.array(z.number().int().positive()).max(100).optional() })),
    async (c) => {
      const id = userId(c.req.param("id"));
      if (!id) return c.json({ error: "not found" }, 404);
      const { ids } = c.req.valid("json");
      await c
        .get("db")
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, id),
            isNull(notifications.readAt),
            ids?.length ? inArray(notifications.id, ids) : undefined,
          ),
        );
      return c.json({ ok: true });
    },
  )

  /* ---------- forgotten passwords ---------- */
  .post("/resets", json(z.object({ email })), async (c) => {
    const { email: address } = c.req.valid("json");
    const okIp = await allow(c, "reset", 5, 3600);
    const okEmail = await allowKey(c, `reset-email:${(await sha256(address)).slice(0, 32)}`, 3, 3600);
    if (!okIp || !okEmail) return c.json({ error: "too many requests, try again in an hour" }, 429);
    const db = c.get("db");
    const [u] = await db.select().from(users).where(eq(users.email, address)).limit(1);
    // The web page says the same thing either way; only the server learns whether a link was made.
    if (!u) return c.json({ token: null });
    const token = randomToken();
    await db.delete(passwordResets).where(eq(passwordResets.userId, u.id));
    await db.insert(passwordResets).values({
      tokenHash: await sha256(token),
      userId: u.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    return c.json({ token, displayName: u.displayName });
  })
  .post(
    "/resets/consume",
    json(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/), passwordHash: hash })),
    async (c) => {
      if (!(await allow(c, "reset-consume", 10, 3600))) return c.json({ error: "too many attempts, try later" }, 429);
      const { token, passwordHash } = c.req.valid("json");
      const db = c.get("db");
      const [reset] = await db
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, await sha256(token)), gt(passwordResets.expiresAt, new Date())))
        .limit(1);
      if (!reset) return c.json({ error: "this link has expired or was already used" }, 400);
      await db.delete(passwordResets).where(eq(passwordResets.userId, reset.userId));
      await db
        .update(users)
        .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, reset.userId));
      return c.json({ ok: true });
    },
  )
  /** Everything the member wrote, to take with them. Heavy, so a few times an hour at most. */
  .get("/users/:id/export", async (c) => {
    const id = userId(c.req.param("id"));
    if (!id) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `export:${id}`, 6, 3600))) return c.json({ error: "try again in a little while" }, 429);
    const diary = await diaryExport(c, id);
    return diary ? c.json(diary) : c.json({ error: "not found" }, 404);
  });
