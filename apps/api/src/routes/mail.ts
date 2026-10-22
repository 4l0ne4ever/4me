import { type Digest, excerpt } from "@4me/shared";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { emailChecks, entries, follows, users } from "../db/schema";
import type { AppEnv } from "../env";
import { isOpen, isReadable, positiveId } from "../lib/entries";
import { allow, allowKey, randomToken, sha256 } from "../lib/guard";
import { json } from "../lib/validate";

// What the web server needs to send email: links that prove an address, and the morning email of new pages.
// Behind the server token like every internal route; the web server does the sending.

const DAY = 86_400_000;
/** A first morning email reaches back this far, and never further. */
const LOOKBACK = 36 * 3600_000;
const PER_EMAIL = 12;

export const mailRoutes = new Hono<AppEnv>()
  /** A link for the member to prove their address: the token for the email, or `verified` if there's nothing to do. */
  .post("/users/:id/email-check", async (c) => {
    const id = positiveId(c.req.param("id"));
    const db = c.get("db");
    const [u] = id ? await db.select().from(users).where(eq(users.id, id)).limit(1) : [];
    if (!u) return c.json({ error: "not found" }, 404);
    if (!u.email) return c.json({ error: "this account has no email address" }, 400);
    if (u.emailVerified) return c.json({ verified: true });
    if (!(await allowKey(c, `email-check:${u.id}`, 3, 3600)))
      return c.json({ error: "a link was sent a moment ago; check your inbox, or try again in an hour" }, 429);
    const token = randomToken();
    await db.delete(emailChecks).where(eq(emailChecks.userId, u.id));
    await db.insert(emailChecks).values({
      tokenHash: await sha256(token),
      userId: u.id,
      email: u.email,
      expiresAt: new Date(Date.now() + DAY),
    });
    return c.json({ token, email: u.email, displayName: u.displayName });
  })
  /** The link was opened: the address it was sent to is the member's, if it is still their address. */
  .post("/email-checks/consume", json(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) })), async (c) => {
    if (!(await allow(c, "email-check-consume", 20, 3600)))
      return c.json({ error: "too many attempts, try later" }, 429);
    const db = c.get("db");
    const [check] = await db
      .select()
      .from(emailChecks)
      .where(
        and(eq(emailChecks.tokenHash, await sha256(c.req.valid("json").token)), gt(emailChecks.expiresAt, new Date())),
      )
      .limit(1);
    if (!check) return c.json({ error: "this link has expired or was already used" }, 400);
    await db.delete(emailChecks).where(eq(emailChecks.userId, check.userId));
    const [u] = await db
      .update(users)
      .set({ emailVerified: true })
      .where(and(eq(users.id, check.userId), eq(users.email, check.email)))
      .returning({ handle: users.handle });
    return u ? c.json({ ok: true, handle: u.handle }) : c.json({ error: "this account's address has changed" }, 400);
  })
  /**
   * The morning emails due: for each member who asked for them (with a proven address), the public pages written
   * since their last one by the diaries they subscribe to. `asOf` goes back with /digests/sent.
   */
  .get("/digests", async (c) => {
    const db = c.get("db");
    const asOf = new Date();
    const readers = await db
      .select({ id: users.id, email: users.email, name: users.displayName, digestAt: users.digestAt })
      .from(users)
      .where(
        and(
          eq(users.emailDigest, true),
          eq(users.emailVerified, true),
          isNotNull(users.email),
          eq(users.status, "active"),
        ),
      )
      .limit(500);
    const due: Digest[] = [];
    for (const r of readers) {
      const since = new Date(Math.max(r.digestAt?.getTime() ?? 0, asOf.getTime() - LOOKBACK));
      const pages = await db
        .select({
          title: entries.title,
          slug: entries.slug,
          mood: entries.mood,
          body: entries.body,
          writtenAt: entries.writtenAt,
          handle: users.handle,
          author: users.displayName,
        })
        .from(follows)
        .innerJoin(entries, eq(entries.authorId, follows.followeeId))
        .innerJoin(users, eq(users.id, entries.authorId))
        .where(
          and(
            eq(follows.followerId, r.id),
            isReadable,
            isOpen,
            // Only what is new since the last email, and since they subscribed.
            sql`${entries.writtenAt} > greatest(${since.toISOString()}::timestamptz, ${follows.createdAt})`,
            sql`${entries.writtenAt} <= ${asOf.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(desc(entries.writtenAt))
        .limit(PER_EMAIL);
      if (pages.length && r.email)
        due.push({
          userId: r.id,
          email: r.email,
          name: r.name,
          pages: pages.map((p) => ({
            title: p.title,
            slug: p.slug,
            handle: p.handle,
            author: p.author,
            mood: p.mood,
            excerpt: excerpt(p.body, 220),
            writtenAt: p.writtenAt.toISOString(),
          })),
        });
    }
    return c.json({ asOf: asOf.toISOString(), due });
  })
  /** These members' emails went out: the next ones start from `asOf`. */
  .post(
    "/digests/sent",
    json(z.object({ userIds: z.array(z.number().int().positive()).max(500), asOf: z.iso.datetime() })),
    async (c) => {
      const { userIds, asOf } = c.req.valid("json");
      if (userIds.length)
        await c
          .get("db")
          .update(users)
          .set({ digestAt: new Date(asOf) })
          .where(inArray(users.id, userIds));
      return c.json({ ok: true });
    },
  )
  /** One click on "unsubscribe" in an email: no more morning emails. */
  .post("/users/:id/digest-off", async (c) => {
    const id = positiveId(c.req.param("id"));
    if (id) await c.get("db").update(users).set({ emailDigest: false }).where(eq(users.id, id));
    return c.json({ ok: true });
  });
