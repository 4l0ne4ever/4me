import { shoutInput } from "@4me/shared";
import { desc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { almost, blasts, catStats, shouts } from "../db/schema";
import type { AppEnv } from "../env";
import { allow, humanCheck, ipHash, looksLikeSpam } from "../lib/guard";
import { toAlmost, toBlast, toShout } from "../lib/map";
import { nowPlaying } from "../lib/music";
import { json } from "../lib/validate";

const catActions = { pet: catStats.pets, feed: catStats.fish, play: catStats.plays } as const;

async function readCat(c: Context<AppEnv>) {
  const [row] = await c.get("db").select().from(catStats).where(eq(catStats.id, 1));
  return { pets: row?.pets ?? 0, fish: row?.fish ?? 0, plays: row?.plays ?? 0 };
}

export const socialRoutes = new Hono<AppEnv>()
  .get("/guestbook", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 40, 1), 100);
    const rows = await c
      .get("db")
      .select()
      .from(shouts)
      .where(eq(shouts.status, "visible"))
      .orderBy(desc(shouts.createdAt))
      .limit(limit);
    c.header("Cache-Control", "public, max-age=10, s-maxage=10");
    return c.json(rows.reverse().map(toShout));
  })
  .post("/guestbook", json(shoutInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "shout", 5, 600))) return c.json({ error: "slow down a little, try again soon" }, 429);
    const status = looksLikeSpam(input.body) ? "pending" : "visible";
    const [row] = await c
      .get("db")
      .insert(shouts)
      .values({ name: input.name, body: input.body, status, ipHash: await ipHash(c) })
      .returning();
    return c.json({ shout: toShout(row!), pending: status === "pending" }, 201);
  })
  .get("/blasts", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 6, 1), 30);
    const rows = await c.get("db").select().from(blasts).orderBy(desc(blasts.createdAt)).limit(limit);
    c.header("Cache-Control", "public, max-age=30, s-maxage=60");
    return c.json(rows.map(toBlast));
  })
  .get("/almost", async (c) => {
    const rows = await c.get("db").select().from(almost).orderBy(desc(almost.deletedAt)).limit(50);
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
  .get("/now-playing", async (c) => {
    const value = await nowPlaying(c.env.LASTFM_API_KEY, c.env.LASTFM_USER);
    c.header("Cache-Control", "public, max-age=30, s-maxage=30");
    return c.json(value);
  })
  .get("/health", (c) => c.json({ ok: true }));
