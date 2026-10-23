import {
  avatarUrl,
  lineInput,
  memberLineInput,
  moodTone,
  NIGHT,
  type NightLine,
  type NightSky,
  nightOf,
} from "@4me/shared";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { entries, nightLines, users } from "../db/schema";
import type { AppEnv } from "../env";
import { isUniqueViolation as dup, isOpen, isReadable, positiveId } from "../lib/entries";
import { allow, allowKey, humanCheck, ipHash } from "../lib/guard";
import { anonymousNameProblem } from "../lib/names";
import { publish } from "../lib/notify";
import { json } from "../lib/validate";

/** The moments a night runs between: 06:00 on its evening's date in Vietnam until 06:00 the next day. */
const bounds = (night: string) => {
  const start = new Date(`${night}T06:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

const toLine = (
  r: typeof nightLines.$inferSelect,
  m?: { avatar: string | null; handle: string | null } | null,
): NightLine => ({
  id: r.id,
  night: r.night,
  name: r.name,
  body: r.body,
  member: r.userId && m?.handle ? { avatar: avatarUrl(m.avatar), handle: m.handle } : null,
  createdAt: r.createdAt.toISOString(),
});

async function linesOf(c: Context<AppEnv>, night: string): Promise<NightLine[]> {
  const rows = await c
    .get("db")
    .select({ l: nightLines, m: { avatar: users.avatar, handle: users.handle } })
    .from(nightLines)
    .leftJoin(users, eq(users.id, nightLines.userId))
    .where(and(eq(nightLines.night, night), eq(nightLines.status, "visible")))
    .orderBy(asc(nightLines.createdAt))
    .limit(300);
  return rows.map((r) => toLine(r.l, r.m));
}

/** Adds a line, one per person per night, and tells everyone reading the poem. */
async function addLine(
  c: Context<AppEnv>,
  values: { userId: number | null; ipHash: string | null; name: string; body: string },
) {
  const night = nightOf(new Date());
  try {
    const [row] = await c
      .get("db")
      .insert(nightLines)
      .values({ night, ...values })
      .returning();
    const line = toLine(row!, values.userId ? await member(c, values.userId) : null);
    publish(c, ["tonight"], { type: "line", line });
    return c.json({ line }, 201);
  } catch (e) {
    if (dup(e)) return c.json({ error: "you've added your line tonight; come back tomorrow night" }, 409);
    throw e;
  }
}

async function member(c: Context<AppEnv>, id: number) {
  const [m] = await c
    .get("db")
    .select({ avatar: users.avatar, handle: users.handle })
    .from(users)
    .where(eq(users.id, id));
  return m ?? null;
}

/** The night as everyone sees it: its sky (from tonight's moods) and its shared poem. */
export const nightRoutes = new Hono<AppEnv>()
  .get("/nights/:night/sky", async (c) => {
    const night = c.req.param("night");
    if (!NIGHT.test(night)) return c.json({ error: "not found" }, 404);
    const { start, end } = bounds(night);
    const rows = await c
      .get("db")
      .select({ mood: entries.mood })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, isOpen, gte(entries.writtenAt, start), lt(entries.writtenAt, end)))
      .limit(500);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const tone = moodTone(r.mood);
      if (tone) counts.set(tone, (counts.get(tone) ?? 0) + 1);
    }
    const sky: NightSky = {
      night,
      total: rows.length,
      tones: [...counts]
        .map(([tone, count]) => ({ tone, count }) as NightSky["tones"][number])
        .sort((a, b) => b.count - a.count),
    };
    c.header("Cache-Control", "public, max-age=60, s-maxage=120");
    return c.json(sky);
  })
  .get("/nights/:night/lines", async (c) => {
    const night = c.req.param("night");
    if (!NIGHT.test(night)) return c.json({ error: "not found" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json(await linesOf(c, night));
  })
  /** A guest's line for tonight. */
  .post("/nights/lines", json(lineInput), async (c) => {
    const input = c.req.valid("json");
    if (!(await humanCheck(c, input.turnstileToken))) return c.json({ error: "please confirm you are human" }, 403);
    if (!(await allow(c, "line", 5, 3600))) return c.json({ error: "slow down a little, try again soon" }, 429);
    const nameProblem = await anonymousNameProblem(c, input.name);
    if (nameProblem) return c.json({ error: nameProblem }, 409);
    return addLine(c, { userId: null, ipHash: await ipHash(c), name: input.name, body: input.body });
  });

/** The member's own: their line for tonight, and their pages from this night a year (and a month) ago. */
export const nightMemberRoutes = new Hono<AppEnv>()
  .post("/users/:id/lines", json(memberLineInput), async (c) => {
    const id = positiveId(c.req.param("id"));
    const [u] = id ? await c.get("db").select().from(users).where(eq(users.id, id)).limit(1) : [];
    if (!u) return c.json({ error: "not found" }, 404);
    if (u.status !== "active") return c.json({ error: "this account can't post right now" }, 403);
    if (!(await allowKey(c, `line:${u.id}`, 5, 3600))) return c.json({ error: "slow down a little" }, 429);
    return addLine(c, { userId: u.id, ipHash: null, name: u.displayName, body: c.req.valid("json").body });
  })
  .get("/users/:id/on-this-night", async (c) => {
    const id = positiveId(c.req.param("id"));
    if (!id) return c.json({ year: [], month: [] });
    const tonight = nightOf(new Date());
    const rows = await c
      .get("db")
      .select({
        title: entries.title,
        slug: entries.slug,
        writtenAt: entries.writtenAt,
        visibility: entries.visibility,
      })
      .from(entries)
      .where(and(eq(entries.authorId, id), lt(entries.writtenAt, new Date(Date.now() - 20 * 86_400_000))))
      .orderBy(desc(entries.writtenAt))
      .limit(3000);
    // The same date a month back (the 31st becomes that month's last day).
    const [ty, tm, td] = tonight.split("-").map(Number) as [number, number, number];
    const prev = new Date(Date.UTC(ty, tm - 2, 1));
    const lastDay = new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    const monthAgo = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(Math.min(td, lastDay))}`;
    const pick = (match: (night: string) => boolean) =>
      rows
        .filter((r) => r.visibility !== "draft" && match(nightOf(r.writtenAt)))
        .map((r) => ({ title: r.title, slug: r.slug, writtenAt: r.writtenAt.toISOString() }));
    return c.json({
      year: pick((n) => n.slice(5) === tonight.slice(5) && n < tonight),
      month: pick((n) => n === monthAgo),
    });
  });
