import { searchable } from "@4me/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { songVideos } from "../db/schema";
import type { AppEnv } from "../env";
import { allow } from "../lib/guard";

const WEEK = 7 * 86_400_000;

/** Asks YouTube for the song's video: the official audio or video, embeddable, in the music category. */
async function findVideo(key: string, artist: string, title: string): Promise<string | null> {
  const q = new URLSearchParams({
    part: "id",
    q: `${artist} ${title}`.trim(),
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10",
    maxResults: "1",
    key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`youtube ${res.status}`);
  const data = (await res.json()) as { items?: Array<{ id?: { videoId?: string } }> };
  const id = data.items?.[0]?.id?.videoId;
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

/**
 * The YouTube video that plays a song in full, for the mixtape. Each song is looked up once and remembered (a search
 * costs a hundredth of the free daily quota); songs with no video are asked about again after a week.
 * Without a YouTube key the answer is always "none", and the mixtape plays the 30-second preview instead.
 */
export const musicRoutes = new Hono<AppEnv>().get("/music/video", async (c) => {
  const artist = (c.req.query("artist") ?? "").trim().slice(0, 120);
  const title = (c.req.query("title") ?? "").trim().slice(0, 120);
  if (!title) return c.json({ videoId: null });
  const key = searchable(`${artist}|${title}`);
  const db = c.get("db");
  const [known] = await db.select().from(songVideos).where(eq(songVideos.key, key)).limit(1);
  if (known && (known.videoId || Date.now() - known.checkedAt.getTime() < WEEK)) {
    c.header("Cache-Control", "public, max-age=86400");
    return c.json({ videoId: known.videoId });
  }
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) return c.json({ videoId: null });
  if (!(await allow(c, "video", 30, 600))) return c.json({ videoId: null });
  let videoId: string | null;
  try {
    videoId = await findVideo(apiKey, artist, title);
  } catch {
    return c.json({ videoId: null });
  }
  await db
    .insert(songVideos)
    .values({ key, videoId })
    .onConflictDoUpdate({ target: songVideos.key, set: { videoId, checkedAt: new Date() } });
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({ videoId });
});
