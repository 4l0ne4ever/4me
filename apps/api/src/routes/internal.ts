import {
  AVATARS,
  type AvatarId,
  displayName,
  email,
  inkState,
  type Me,
  memberNoteInput,
  memberShoutInput,
  nameKey,
  profileInput,
} from "@4me/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { entries, notes, oauthAccounts, passwordResets, shouts, users } from "../db/schema";
import type { AppEnv } from "../env";
import { allow, allowKey, humanCheck, isReservedName, looksLikeSpam, sameSecret, sha256 } from "../lib/guard";
import { toNote, toShout } from "../lib/map";
import { json } from "../lib/validate";

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
    displayName: u.displayName,
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

function uniqueField(e: unknown): "email" | "name" | null {
  const err = e as {
    code?: string;
    constraint?: string;
    message?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return null;
  const where = `${err?.constraint ?? err?.cause?.constraint ?? ""} ${err?.message ?? ""}`;
  return where.includes("email") ? "email" : "name";
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
          .values({
            email: input.email,
            displayName: input.displayName,
            nameKey: nameKey(input.displayName),
            passwordHash: input.passwordHash,
          })
          .returning();
        return c.json(await toMe(c, u!), 201);
      } catch (e) {
        const field = uniqueField(e);
        // Sign-up has to say the address is in use; the per-IP limit above keeps that from being used to probe.
        if (field === "email")
          return c.json({ error: "an account with that email already exists", field: "email" }, 409);
        if (field === "name") return c.json({ error: "that name is taken", field: "displayName" }, 409);
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
    if (input.avatar) set.avatar = input.avatar;
    if (input.ink) set.ink = input.ink;
    if (Object.keys(set).length === 0) return c.json(await toMe(c, u));
    try {
      const [next] = await c.get("db").update(users).set(set).where(eq(users.id, u.id)).returning();
      return c.json(await toMe(c, next!));
    } catch (e) {
      if (uniqueField(e)) return c.json({ error: "that name is taken", field: "displayName" }, 409);
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
    // Their words stay in the diary's history, but no longer carry their name.
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
      .select({ n: notes, slug: entries.slug, title: entries.title })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .where(eq(notes.userId, id))
      .orderBy(desc(notes.createdAt))
      .limit(100);
    return c.json(
      rows.map((r) => ({
        id: r.n.id,
        body: r.n.body,
        createdAt: r.n.createdAt.toISOString(),
        slug: r.slug,
        title: r.title,
        status: r.n.status,
      })),
    );
  })

  /* ---------- members write under their own name ---------- */
  .post("/users/:id/notes/:slug", json(memberNoteInput), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `member-note:${u.id}`, 10, 600)))
      return c.json({ error: "slow down a little, try again soon" }, 429);
    const db = c.get("db");
    const [entry] = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.visibility, "public"), eq(entries.slug, c.req.param("slug"))));
    if (!entry) return c.json({ error: "not found" }, 404);
    const { body } = c.req.valid("json");
    const status = looksLikeSpam(body) ? "pending" : "visible";
    const [row] = await db
      .insert(notes)
      .values({ entryId: entry.id, userId: u.id, name: u.displayName, body, status })
      .returning();
    return c.json({ note: toNote(row!, u.avatar), pending: status === "pending" }, 201);
  })
  .post("/users/:id/shouts", json(memberShoutInput), async (c) => {
    const u = await loadUser(c, c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    if (!(await allowKey(c, `member-shout:${u.id}`, 10, 600)))
      return c.json({ error: "slow down a little, try again soon" }, 429);
    const { body } = c.req.valid("json");
    const status = looksLikeSpam(body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(shouts)
      .values({ userId: u.id, name: u.displayName, body, status })
      .returning();
    return c.json({ shout: toShout(row!, u.avatar), pending: status === "pending" }, 201);
  })

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
  );
