import type { LiveEvent } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings, Live } from "../src/env";
import { lately } from "../src/lib/music";
import { MemoryHub, type Socket } from "../src/live/memory";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const sent: Array<{ topics: string[]; event: LiveEvent }> = [];
const recorder: Live = { publish: (topics, event) => void sent.push({ topics, event }) };
const of = (type: LiveEvent["type"]) => sent.filter((s) => s.event.type === type);

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;
function call(path: string, init: RequestInit & { internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `203.0.113.${++n % 250}`);
  if (init.internal !== false) {
    headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
    headers.set("x-client-ip", `198.51.100.${n % 250}`);
  }
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown, internal = true) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), internal });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

let lan: { id: number; handle: string };
let mai: { id: number; handle: string };
let letter: { id: number; slug: string };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
    () => recorder,
  );
  mai = await json(send("POST", "/internal/users", { email: "m@x.co", displayName: "Mai", passwordHash: HASH }));
  [lan] = (await db
    .select({ id: schema.users.id, handle: schema.users.handle })
    .from(schema.users)
    .where(eq(schema.users.handle, "lan"))) as [typeof lan];
  await send("POST", `/internal/users/${lan.id}/subscriptions/${mai.handle}`);
});
beforeEach(() => {
  sent.length = 0;
});

describe("sealed letters", () => {
  it("keeps a sealed letter's words from readers, but not from its writer", async () => {
    const opensAt = new Date(Date.now() + 86_400_000).toISOString();
    letter = await json(
      send("POST", `/internal/users/${mai.id}/entries`, {
        title: "To me, next year",
        body: "the secret part",
        opensAt,
        song: {
          id: 1,
          title: "s",
          artist: "a",
          coverUrl: null,
          previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a",
          url: "",
        },
      }),
    );
    // Not announced yet, to Tonight or to subscribers.
    expect(of("entry")).toHaveLength(0);
    expect(of("notify")).toHaveLength(0);
    const seen = await json<{ body: string; song: unknown; sealedUntil: string; title: string }>(
      call(`/entries/by/${mai.handle}/${letter.slug}`, { internal: false }),
    );
    expect(seen).toMatchObject({ title: "To me, next year", body: "", song: null, sealedUntil: opensAt });
    const own = await json<{ body: string }>(call(`/internal/users/${mai.id}/entries/${letter.id}`));
    expect(own.body).toBe("the secret part");
  });

  it("can't be answered, reacted to or found by its words while sealed", async () => {
    expect((await send("POST", `/entries/${letter.id}/notes`, { body: "early" }, false)).status).toBe(404);
    expect((await send("POST", `/entries/${letter.id}/react`, { kind: "love" }, false)).status).toBe(404);
    const found = await json<{ pages: unknown[] }>(call("/search?q=secret%20part", { internal: false }));
    expect(found.pages).toHaveLength(0);
  });

  it("opens on its day, once, and tells its writer and subscribers", async () => {
    await db
      .update(schema.entries)
      .set({ opensAt: new Date(Date.now() - 1000) })
      .where(eq(schema.entries.id, letter.id));
    await send("POST", "/internal/letters/open");
    await send("POST", "/internal/letters/open"); // a second run tells nobody again
    expect(of("entry")).toHaveLength(1);
    const told = of("notify").map((s) => s.event.type === "notify" && s.event.notification.text);
    expect(told).toEqual([
      "Your sealed letter “To me, next year” just opened",
      "Mai's sealed letter just opened: “To me, next year”",
    ]);
    const seen = await json<{ body: string; sealedUntil: string | null }>(
      call(`/entries/by/${mai.handle}/${letter.slug}`, { internal: false }),
    );
    expect(seen).toMatchObject({ body: "the secret part", sealedUntil: null });
  });

  it("refuses a seal longer than ten years", async () => {
    const res = await send("POST", `/internal/users/${mai.id}/entries`, {
      title: "too far",
      body: "x",
      opensAt: new Date(Date.now() + 11 * 366 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });
});

describe("the archive", () => {
  it("lists a diary's pages as stars, brighter with notes and reactions", async () => {
    const stars = await json<Array<{ slug: string; glow: number; author: { handle: string } }>>(
      call("/archive?author=4me", { internal: false }),
    );
    expect(stars.map((s) => s.slug)).toEqual([
      "the-lamps-came-on-early",
      "thirteen-minutes-to-three",
      "bus-18-and-the-fogged-up-window",
      "snow-came-early-on-the-hill",
    ]);
    expect(stars[0]?.glow).toBe(4);
    const everyone = await json<unknown[]>(call("/archive", { internal: false }));
    expect(everyone.length).toBeGreaterThan(stars.length);
  });
});

describe("lit windows", () => {
  it("counts everyone with 4me open and tells the skyline", () => {
    const hub = new MemoryHub();
    const got: LiveEvent[] = [];
    const sock = (): Socket => ({ readyState: 1, send: (d) => got.push(JSON.parse(d)) });
    const a = sock();
    hub.add(a, ["tonight"]);
    hub.add(sock(), ["tonight", "entry:1"]);
    expect(got.filter((e) => e.type === "awake").at(-1)).toEqual({ type: "awake", n: 2 });
    hub.remove(a);
  });
});

describe("whole songs", () => {
  it("answers 'no video' without a YouTube key, so the mixtape plays the preview", async () => {
    const res = await json<{ videoId: string | null }>(
      call("/music/video?artist=Ngọt&title=Em%20Dạo%20Này", { internal: false }),
    );
    expect(res).toEqual({ videoId: null });
  });

  it("remembers each song's video so YouTube is asked only once", async () => {
    await db.insert(schema.songVideos).values({ key: "ngot|em dao nay", videoId: "abcdef12345" });
    const res = await json<{ videoId: string | null }>(
      call("/music/video?artist=Ngọt&title=Em%20Dạo%20Này", { internal: false }),
    );
    expect(res).toEqual({ videoId: "abcdef12345" });
  });
});

describe("a writer's recent songs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is empty without Last.fm", async () => {
    expect(await json(call("/recent-tracks?user=nobody", { internal: false }))).toEqual([]);
  });

  it("keeps each song once and leaves out the one playing now", async () => {
    const track = (name: string, now = false) => ({
      name,
      url: `https://last.fm/${name}`,
      artist: { "#text": "Ngọt" },
      ...(now ? { "@attr": { nowplaying: "true" } } : {}),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ recenttracks: { track: [track("Live", true), track("A"), track("B"), track("A")] } }),
      ),
    );
    const songs = await lately("key", "lastfm-user-for-test");
    expect(songs.map((s) => s.title)).toEqual(["A", "B"]);
  });
});
