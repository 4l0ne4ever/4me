import { readUploadTicket } from "@4me/shared";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uploads, users } from "../db/schema";
import type { AppEnv } from "../env";
import { dropAbandonedUploads } from "../lib/entries";
import { allowKey } from "../lib/guard";
import { cleanJpeg, MAX_UPLOAD_BYTES } from "../lib/media";

/** How much each member may keep in the bucket, and how many photos a day they may send. */
const QUOTA_BYTES = 300 * 1024 * 1024;
const UPLOADS_PER_DAY = 60;

type EdgeCache = {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
};
const edgeCache = () => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

export const mediaRoutes = new Hono<AppEnv>()
  /**
   * A member's photo, straight from the browser: the web server signed a short-lived ticket for them, the photo
   * is a JPEG the browser already shrank, and its metadata (EXIF, GPS) is stripped here again before storing.
   */
  .post("/uploads", async (c) => {
    const store = c.get("media");
    if (!store) return c.json({ error: "photo uploads aren't switched on yet" }, 503);
    const uid = await readUploadTicket(c.req.header("x-upload-ticket") ?? "", c.env.ADMIN_TOKEN);
    if (!uid) return c.json({ error: "sign in again to upload photos" }, 401);
    const [u] = await c.get("db").select({ status: users.status }).from(users).where(eq(users.id, uid)).limit(1);
    if (!u) return c.json({ error: "sign in again to upload photos" }, 401);
    if (u.status !== "active") return c.json({ error: "this account can't post right now" }, 403);
    if (!(c.req.header("content-type") ?? "").startsWith("image/jpeg"))
      return c.json({ error: "photos are sent as JPEG" }, 415);
    if (Number(c.req.header("content-length") ?? 0) > MAX_UPLOAD_BYTES)
      return c.json({ error: "that photo is too large (4 MB at most)" }, 413);
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.length > MAX_UPLOAD_BYTES) return c.json({ error: "that photo is too large (4 MB at most)" }, 413);
    const clean = cleanJpeg(raw);
    if (!clean) return c.json({ error: "that file isn't a photo we can use" }, 415);

    if (!(await allowKey(c, `upload:${uid}`, UPLOADS_PER_DAY, 86400)))
      return c.json({ error: "that's a lot of photos for one day, try again tomorrow" }, 429);
    const [{ used } = { used: 0 }] = await c
      .get("db")
      .select({ used: sql<number>`coalesce(sum(${uploads.bytes}), 0)::int` })
      .from(uploads)
      .where(eq(uploads.userId, uid));
    if (used + clean.bytes.length > QUOTA_BYTES)
      return c.json({ error: "your photo space is full, delete some old pages first" }, 413);

    const key = `u/${uid}/${crypto.randomUUID()}.jpg`;
    await store.put(key, clean.bytes, "image/jpeg");
    await c.get("db").insert(uploads).values({ key, userId: uid, bytes: clean.bytes.length });
    if (Math.random() < 0.1) await dropAbandonedUploads(c, uid);
    const path = `/media/${key}`;
    return c.json({ path, url: `${new URL(c.req.url).origin}${path}`, width: clean.width, height: clean.height }, 201);
  })
  .get("/media/u/:uid/:file", async (c) => {
    const { uid, file } = c.req.param();
    if (!/^\d{1,10}$/.test(uid) || !/^[a-z0-9-]{8,64}\.jpg$/.test(file)) return c.json({ error: "not found" }, 404);
    const cache = edgeCache();
    const cached = await cache?.match(c.req.raw);
    if (cached) return cached;
    const store = c.get("media");
    const found = store ? await store.get(`u/${uid}/${file}`) : null;
    if (!found) return c.json({ error: "not found" }, 404);
    const res = new Response(found.body, {
      headers: {
        "content-type": found.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        // The diary is on another site (Vercel), so its pages must be allowed to show these images.
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "content-security-policy": "default-src 'none'",
      },
    });
    if (cache) c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
    return res;
  });
