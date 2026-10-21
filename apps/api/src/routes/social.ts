import { handle as handleSchema, type Profile, shoutInput } from "@4me/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { almost, blasts, catStats, entries, follows, shouts, users } from "../db/schema";
import type { AppEnv } from "../env";
import { isReadable } from "../lib/entries";
import { allow, humanCheck, ipHash, looksLikeSpam } from "../lib/guard";
import { toAlmost, toAuthor, toBlast, toShout } from "../lib/map";
import { lately, nowPlaying } from "../lib/music";
import { anonymousNameProblem } from "../lib/names";
import { notify, publish } from "../lib/notify";
import { json } from "../lib/validate";

const catActions = { pet: catStats.pets, feed: catStats.fish, play: catStats.plays } as const;

async function readCat(c: Context<AppEnv>) {
  const [row] = await c.get("db").select().from(catStats).where(eq(catStats.id, 1));
  return { pets: row?.pets ?? 0, fish: row?.fish ?? 0, plays: row?.plays ?? 0 };
}

/** An active member by handle. Suspended members' desktops are closed to the public. */
export async function activeMember(c: Context<AppEnv>, raw: string | undefined) {
  const parsed = handleSchema.safeParse(raw ?? "");
  // Reserved handles fail the schema but "4me", the original author, still has a desktop.
  const handle = parsed.success ? parsed.data : raw?.toLowerCase() === "4me" ? "4me" : null;
  if (!handle) return null;
  const [u] = await c
    .get("db")
    .select()
    .from(users)
    .where(and(eq(users.handle, handle), eq(users.status, "active")))
    .limit(1);
  return u ?? null;
}

export const socialRoutes = new Hono<AppEnv>()
  .get("/profiles/:handle", async (c) => {
    const u = await activeMember(c, c.req.param("handle"));
    if (!u) return c.json({ error: "not found" }, 404);
    const [{ n } = { n: 0 }] = await c
      .get("db")
      .select({ n: sql<number>`count(*)::int` })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, eq(entries.authorId, u.id)));
    const [{ subs } = { subs: 0 }] = await c
      .get("db")
      .select({ subs: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followeeId, u.id));
    const profile: Profile = {
      ...toAuthor({ handle: u.handle, name: u.displayName, avatar: u.avatar }),
      bio: u.bio,
      since: u.createdAt.toISOString(),
      nights: n,
      subscribers: subs,
    };
    c.header("Cache-Control", "public, max-age=30, s-maxage=60");
    return c.json(profile);
  })
  /** `?owner=<handle>` is that member's guestbook; without it, the shared one on the front desktop. */
  .get("/guestbook", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 40, 1), 100);
    const ownerHandle = c.req.query("owner");
    const owner = ownerHandle ? await activeMember(c, ownerHandle) : null;
    if (ownerHandle && !owner) return c.json([]);
    const rows = await c
      .get("db")
      .select({ s: shouts, m: { avatar: users.avatar, handle: users.handle } })
      .from(shouts)
      .leftJoin(users, eq(users.id, shouts.userId))
      .where(and(eq(shouts.status, "visible"), owner ? eq(shouts.ownerId, owner.id) : isNull(shouts.ownerId)))
      .orderBy(desc(shouts.createdAt))
      .limit(limit);
    c.header("Cache-Control", "public, max-age=10, s-maxage=10");
    return c.json(rows.reverse().map((r) => toShout(r.s, r.m)));
  })
  .post("/guestbook", json(shoutInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "shout", 5, 600))) return c.json({ error: "slow down a little, try again soon" }, 429);
    const nameProblem = await anonymousNameProblem(c, input.name);
    if (nameProblem) return c.json({ error: nameProblem }, 409);
    const owner = input.owner ? await activeMember(c, input.owner) : null;
    if (input.owner && !owner) return c.json({ error: "not found" }, 404);
    const status = looksLikeSpam(input.body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(shouts)
      .values({ ownerId: owner?.id ?? null, name: input.name, body: input.body, status, ipHash: await ipHash(c) })
      .returning();
    const shout = toShout(row!);
    if (status === "visible")
      publish(c, [`guest:${owner?.handle ?? "_"}`], { type: "shout", owner: owner?.handle ?? null, shout });
    if (owner)
      await notify(c, owner.id, {
        kind: "shout",
        text: `${input.name} signed your guestbook${status === "pending" ? " (waiting for approval)" : ""}`,
        link: `/u/${owner.handle}?open=guest`,
        actor: { name: input.name, avatar: null },
      });
    return c.json({ shout, pending: status === "pending" }, 201);
  })
  .get("/blasts", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 6, 1), 30);
    const u = await activeMember(c, c.req.query("author"));
    if (!u) return c.json([]);
    const rows = await c
      .get("db")
      .select()
      .from(blasts)
      .where(eq(blasts.authorId, u.id))
      .orderBy(desc(blasts.createdAt))
      .limit(limit);
    c.header("Cache-Control", "public, max-age=30, s-maxage=60");
    return c.json(rows.map(toBlast));
  })
  .get("/almost", async (c) => {
    const u = await activeMember(c, c.req.query("author"));
    if (!u) return c.json([]);
    const rows = await c
      .get("db")
      .select()
      .from(almost)
      .where(eq(almost.authorId, u.id))
      .orderBy(desc(almost.deletedAt))
      .limit(50);
    c.header("Cache-Control", "public, max-age=60, s-maxage=120");
    return c.json(rows.map(toAlmost));
  })
  .get("/cat", async (c) => c.json(await readCat(c)))
  .post("/cat/:action", async (c) => {
    const action = c.req.param("action") as keyof typeof catActions;
    const column = catActions[action];
    if (!column) return c.json({ error: "Ink does not know that one" }, 404);
    if (!(await allow(c, "cat", 40, 60))) return c.json({ error: "Ink needs a moment" }, 429);
    const field = action === "pet" ? "pets" : action === "feed" ? "fish" : "plays";
    await c
      .get("db")
      .insert(catStats)
      .values({ id: 1, [field]: 1 })
      .onConflictDoUpdate({ target: catStats.id, set: { [field]: sql`${column} + 1` } });
    return c.json(await readCat(c));
  })
  /** `?user=<handle>`: what that member is listening to, if they linked Last.fm. Otherwise the site owner's. */
  .get("/now-playing", async (c) => {
    const handle = c.req.query("user");
    const lastfm = handle ? (await activeMember(c, handle))?.lastfmUser : c.env.LASTFM_USER;
    const value = await nowPlaying(c.env.LASTFM_API_KEY, lastfm || undefined);
    c.header("Cache-Control", "public, max-age=30, s-maxage=30");
    return c.json(value);
  })
  /** `?user=<handle>`: that member's last few songs on Last.fm, for their mixtape. */
  .get("/recent-tracks", async (c) => {
    const handle = c.req.query("user");
    const lastfm = handle ? (await activeMember(c, handle))?.lastfmUser : null;
    const value = await lately(c.env.LASTFM_API_KEY, lastfm || undefined);
    c.header("Cache-Control", "public, max-age=60, s-maxage=60");
    return c.json(value);
  })
  /** `photos` says whether the photo bucket is configured (S3_* secrets), without saying anything about them. */
  .get("/health", (c) => c.json({ ok: true, photos: Boolean(c.get("media")) }));
