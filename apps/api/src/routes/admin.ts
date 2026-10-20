import { almostInput, blastInput, entryInput, moderationInput, slugify } from "@4me/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { almost, blasts, entries, notes, shouts } from "../db/schema";
import type { AppEnv } from "../env";
import { sameSecret } from "../lib/guard";
import { toAlmost, toBlast, toEntry, toNote, toShout } from "../lib/map";
import { resolveSong } from "../lib/music";
import { json } from "../lib/validate";
import { noteCount } from "./entries";

const id = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function entryValues(input: z.output<typeof entryInput>) {
  const writtenAt = input.writtenAt ? new Date(input.writtenAt) : new Date();
  const song = input.songUrl
    ? await resolveSong(input.songUrl, input.songTitle, input.songArtist)
    : input.songTitle
      ? { title: input.songTitle, artist: input.songArtist ?? "", url: "", embedUrl: null, coverUrl: null }
      : null;
  return {
    slug: input.slug || slugify(input.title, writtenAt),
    title: input.title,
    body: input.body,
    mood: input.mood,
    weather: input.weather,
    writtenAt,
    songTitle: song?.title ?? null,
    songArtist: song?.artist ?? null,
    songUrl: song?.url || null,
    songEmbedUrl: song?.embedUrl ?? null,
    songCoverUrl: song?.coverUrl ?? null,
    photos: input.photos,
    visibility: input.visibility,
    updatedAt: new Date(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Author-only routes. The web app's server calls these with the ADMIN_TOKEN; browsers never see it. */
export const adminRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !(await sameSecret(token, c.env.ADMIN_TOKEN))) return c.json({ error: "unauthorised" }, 401);
    await next();
  })
  .get("/entries", async (c) => {
    const rows = await c
      .get("db")
      .select({ e: entries, noteCount })
      .from(entries)
      .orderBy(desc(entries.writtenAt))
      .limit(200);
    return c.json(rows.map((r) => toEntry({ ...r.e, noteCount: r.noteCount })));
  })
  .get("/entries/:id", async (c) => {
    const entryId = id(c.req.param("id"));
    if (!entryId) return c.json({ error: "not found" }, 404);
    const [row] = await c.get("db").select().from(entries).where(eq(entries.id, entryId));
    return row ? c.json(toEntry(row)) : c.json({ error: "not found" }, 404);
  })
  .post("/entries", json(entryInput), async (c) => {
    try {
      const [row] = await c
        .get("db")
        .insert(entries)
        .values(await entryValues(c.req.valid("json")))
        .returning();
      return c.json(toEntry(row!), 201);
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: "that slug is taken" }, 409);
      throw e;
    }
  })
  .put("/entries/:id", json(entryInput), async (c) => {
    const entryId = id(c.req.param("id"));
    if (!entryId) return c.json({ error: "not found" }, 404);
    try {
      const [row] = await c
        .get("db")
        .update(entries)
        .set(await entryValues(c.req.valid("json")))
        .where(eq(entries.id, entryId))
        .returning();
      return row ? c.json(toEntry(row)) : c.json({ error: "not found" }, 404);
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: "that slug is taken" }, 409);
      throw e;
    }
  })
  .delete("/entries/:id", async (c) => {
    const entryId = id(c.req.param("id"));
    if (!entryId) return c.json({ error: "not found" }, 404);
    const [row] = await c.get("db").delete(entries).where(eq(entries.id, entryId)).returning({ id: entries.id });
    return row ? c.json({ deleted: row.id }) : c.json({ error: "not found" }, 404);
  })
  .post("/entries/:id/reply", json(z.object({ body: z.string().trim().min(1).max(500) })), async (c) => {
    const entryId = id(c.req.param("id"));
    if (!entryId) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .insert(notes)
      .values({ entryId, name: "4me", body: c.req.valid("json").body, isAuthor: true })
      .returning();
    return c.json(toNote(row!), 201);
  })
  .post(
    "/song",
    json(z.object({ url: z.url(), title: z.string().optional(), artist: z.string().optional() })),
    async (c) => {
      const { url, title, artist } = c.req.valid("json");
      return c.json(await resolveSong(url, title, artist));
    },
  )
  .post("/blasts", json(blastInput), async (c) => {
    const [row] = await c.get("db").insert(blasts).values(c.req.valid("json")).returning();
    return c.json(toBlast(row!), 201);
  })
  .delete("/blasts/:id", async (c) => {
    const blastId = id(c.req.param("id"));
    if (!blastId) return c.json({ error: "not found" }, 404);
    await c.get("db").delete(blasts).where(eq(blasts.id, blastId));
    return c.json({ deleted: blastId });
  })
  .post("/almost", json(almostInput), async (c) => {
    const input = c.req.valid("json");
    const [row] = await c
      .get("db")
      .insert(almost)
      .values({ body: input.body, deletedAt: input.deletedAt ? new Date(input.deletedAt) : new Date() })
      .returning();
    return c.json(toAlmost(row!), 201);
  })
  .delete("/almost/:id", async (c) => {
    const almostId = id(c.req.param("id"));
    if (!almostId) return c.json({ error: "not found" }, 404);
    await c.get("db").delete(almost).where(eq(almost.id, almostId));
    return c.json({ deleted: almostId });
  })
  .get("/notes", async (c) => {
    const status = c.req.query("status") === "pending" ? "pending" : undefined;
    const rows = await c
      .get("db")
      .select({ n: notes, slug: entries.slug, title: entries.title, status: notes.status })
      .from(notes)
      .innerJoin(entries, eq(entries.id, notes.entryId))
      .where(status ? eq(notes.status, status) : undefined)
      .orderBy(desc(notes.createdAt))
      .limit(100);
    return c.json(rows.map((r) => ({ ...toNote(r.n), slug: r.slug, title: r.title, status: r.status })));
  })
  .patch("/notes/:id", json(moderationInput), async (c) => {
    const noteId = id(c.req.param("id"));
    if (!noteId) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(notes)
      .set({ status: c.req.valid("json").status })
      .where(eq(notes.id, noteId))
      .returning();
    return row ? c.json(toNote(row)) : c.json({ error: "not found" }, 404);
  })
  .get("/shouts", async (c) => {
    const rows = await c.get("db").select().from(shouts).orderBy(desc(shouts.createdAt)).limit(100);
    return c.json(rows.map((r) => ({ ...toShout(r), status: r.status })));
  })
  .patch("/shouts/:id", json(moderationInput), async (c) => {
    const shoutId = id(c.req.param("id"));
    if (!shoutId) return c.json({ error: "not found" }, 404);
    const [row] = await c
      .get("db")
      .update(shouts)
      .set({ status: c.req.valid("json").status })
      .where(eq(shouts.id, shoutId))
      .returning();
    return row ? c.json(toShout(row)) : c.json({ error: "not found" }, 404);
  });
