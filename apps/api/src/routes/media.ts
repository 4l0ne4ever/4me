import { readTicket } from "@4me/shared";
import { and, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { entries, uploads, users } from "../db/schema";
import type { AppEnv } from "../env";
import { dropAbandonedUploads, isOpen, isReadable, links } from "../lib/entries";
import { allowKey } from "../lib/guard";
import { isSealed } from "../lib/map";
import { cleanJpeg, MAX_UPLOAD_BYTES } from "../lib/media";
import { cachedPhoto, checkSigned, edgeCache, photoLink, readSigned, UNPLACED } from "../lib/photo-links";

/** How much each member may keep in the bucket, and how many photos a day they may send. */
const QUOTA_BYTES = 300 * 1024 * 1024;
const UPLOADS_PER_DAY = 60;

export const mediaRoutes = new Hono<AppEnv>()
  /**
   * A member's photo, straight from the browser: the web server signed a short-lived ticket for them, the photo
   * is a JPEG the browser already shrank, and its metadata (EXIF, GPS) is stripped here again before storing.
   */
  .post("/uploads", async (c) => {
    const store = c.get("media");
    if (!store) return c.json({ error: "photo uploads aren't switched on yet" }, 503);
    const uid = await readTicket("upload", c.req.header("x-upload-ticket") ?? "", c.env.ADMIN_TOKEN);
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
    // Not on a page yet, so only its writer can see it: a signed address.
    const url = photoLink(links(c), path, UNPLACED, null);
    return c.json({ path, url, width: clean.width, height: clean.height }, 201);
  })
  /**
   * A photo, only while someone may see it: with a signed address (see photo-links.ts) for the page it was handed
   * out for, in the state that page is in now; with a plain one, while a page anyone may read shows it. Deleted
   * photos, and photos on pages made private, sealed or hidden since, are not found. The bytes are kept at the edge
   * (a photo's address never points at different bytes), but only after that check, so nothing deleted is served.
   */
  .get("/media/u/:uid/:file", async (c) => {
    const { uid, file } = c.req.param();
    if (!/^\d{1,10}$/.test(uid) || !/^[a-z0-9-]{8,64}\.jpg$/.test(file)) return c.json({ error: "not found" }, 404);
    const key = `u/${uid}/${file}`;
    const access = await photoAccess(c, Number(uid), key);
    if (!access) return c.json({ error: "not found" }, 404);

    const cache = edgeCache();
    const cacheKey = cachedPhoto(new URL(c.req.url).origin, key);
    let body: ReadableStream | Uint8Array | null = null;
    let contentType = "image/jpeg";
    const cached = await cache?.match(cacheKey);
    if (cached) {
      body = cached.body;
      contentType = cached.headers.get("content-type") ?? contentType;
    } else {
      const store = c.get("media");
      const found = store ? await store.get(key) : null;
      if (!found) return c.json({ error: "not found" }, 404);
      contentType = found.contentType;
      if (cache) {
        const [mine, kept] = found.body instanceof Uint8Array ? [found.body, found.body] : found.body.tee();
        body = mine;
        const copy = new Response(kept, {
          headers: { "content-type": contentType, "cache-control": "public, max-age=86400" },
        });
        c.executionCtx.waitUntil(cache.put(cacheKey, copy));
      } else body = found.body;
    }
    return new Response(body, {
      headers: {
        "content-type": contentType,
        // Kept briefly, and only by the reader's own browser when the page isn't public: a page made private or a
        // photo deleted stops showing within minutes everywhere.
        "cache-control": access === "public" ? "public, max-age=300" : "private, max-age=3600",
        // The diary is on another site (Vercel), so its pages must be allowed to show these images.
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      },
    });
  });

/** Whether this photo may be shown, and to whom: "public" (anyone), "signed" (its writer), or null. */
async function photoAccess(c: Context<AppEnv>, uid: number, key: string): Promise<"public" | "signed" | null> {
  const db = c.get("db");
  const path = `/media/${key}`;
  const shows = sql`${entries.photos} @> ${JSON.stringify([{ url: path }])}::jsonb`;
  const kept = sql`exists (select 1 from ${uploads} where ${uploads.key} = ${key} and ${uploads.userId} = ${uid})`;

  const signed = readSigned(c.req.query());
  if (signed) {
    const secret = c.env.ADMIN_TOKEN;
    if (signed.entryId === UNPLACED) {
      const [up] = await db
        .select({ key: uploads.key })
        .from(uploads)
        .where(and(eq(uploads.key, key), eq(uploads.userId, uid)))
        .limit(1);
      if (up && checkSigned(secret, key, signed, null)) return "signed";
    } else {
      const [page] = await db
        .select({ visibility: entries.visibility, status: entries.status, opensAt: entries.opensAt })
        .from(entries)
        .where(and(eq(entries.id, signed.entryId), eq(entries.authorId, uid), shows, kept))
        .limit(1);
      const state = page && { visibility: page.visibility, status: page.status, sealed: isSealed(page) };
      if (state && checkSigned(secret, key, signed, state)) return "signed";
    }
  }
  // Without a (still valid) signature: some page anyone may read shows it.
  const [open] = await db
    .select({ id: entries.id })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(isReadable, isOpen, eq(entries.authorId, uid), shows, kept))
    .limit(1);
  return open ? "public" : null;
}
