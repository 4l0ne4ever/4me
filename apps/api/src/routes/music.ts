import { Hono } from "hono";
import type { AppEnv } from "../env";
import { allow } from "../lib/guard";
import { searchSongs } from "../lib/music";

/** The song picker's search box. Public, so the browser asks it directly; limited per visitor. */
export const musicRoutes = new Hono<AppEnv>().get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return c.json([]);
  if (!(await allow(c, "music", 40, 60))) return c.json({ error: "searching too fast, give it a moment" }, 429);
  try {
    const results = await searchSongs(q);
    c.header("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return c.json(results);
  } catch {
    return c.json({ error: "the music search isn't answering, try again in a moment" }, 502);
  }
});
