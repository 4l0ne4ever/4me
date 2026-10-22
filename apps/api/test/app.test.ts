import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = {
  DATABASE_URL: "pglite",
  ADMIN_TOKEN: "test-admin-token",
  WEB_ORIGIN: "http://localhost:3000",
  IP_SALT: "test",
};

let app: ReturnType<typeof createApp>;
let db: DB;
let ipCounter = 0;
let lamps: number;

function call(path: string, init: RequestInit & { ip?: string; admin?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `10.0.0.${++ipCounter}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.admin) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  return app.request(path, { ...init, headers }, env);
}
const post = (path: string, body: unknown, extra: { ip?: string; admin?: boolean } = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), ...extra });

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(() => db);
  const [row] = await db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(eq(schema.entries.slug, "the-lamps-came-on-early"));
  lamps = row!.id;
});

describe("public reading", () => {
  it("lists everyone's public pages newest first, each with its author", async () => {
    const res = await call("/entries");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ slug: string; noteCount: number; author: { handle: string } }>;
    expect(list[0]).toMatchObject({ slug: "the-lamps-came-on-early", noteCount: 4, author: { handle: "4me" } });
    expect(list[1]).toMatchObject({ slug: "the-last-tram", author: { handle: "lan" } });
  });

  it("lists one member's pages", async () => {
    const list = (await (await call("/entries?author=lan")).json()) as Array<{ slug: string }>;
    expect(list.map((e) => e.slug)).toEqual(["the-last-tram"]);
  });

  it("returns the latest page in full, and a page by its author's address", async () => {
    const latest = (await (await call("/entries/latest?author=4me")).json()) as {
      title: string;
      song: { artist: string };
      photos: unknown[];
    };
    expect(latest.title).toBe("The lamps came on before I got home");
    expect(latest.song.artist).toBe("Radiohead");
    expect(latest.photos).toHaveLength(2);
    expect((await call("/entries/by/lan/the-last-tram")).status).toBe(200);
    expect((await call("/entries/by/lan/the-lamps-came-on-early")).status).toBe(404);
  });

  it("lists every public page's address for search engines, and nothing more", async () => {
    const res = await call("/entries/sitemap");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<Record<string, string>>;
    expect(list).toContainEqual(expect.objectContaining({ handle: "lan", slug: "the-last-tram" }));
    expect(Object.keys(list[0]!).sort()).toEqual(["at", "handle", "slug"]);
  });

  it("shows a member's desktop details", async () => {
    const profile = await (await call("/profiles/lan")).json();
    expect(profile).toMatchObject({ handle: "lan", name: "Lan", nights: 1, bio: "night shifts, early trams." });
    expect((await call("/profiles/nobody")).status).toBe(404);
  });

  it("404s an unknown page", async () => {
    expect((await call("/entries/by/4me/nope")).status).toBe(404);
    expect((await call("/entries/999999/notes")).status).toBe(404);
  });
});

describe("notes and guestbooks", () => {
  it("accepts a note and shows it", async () => {
    const res = await post(`/entries/${lamps}/notes`, { name: "", body: "hi from the test" });
    expect(res.status).toBe(201);
    const { note, pending } = (await res.json()) as { note: { name: string }; pending: boolean };
    expect(note.name).toBe("a stranger");
    expect(pending).toBe(false);
    const notes = (await (await call(`/entries/${lamps}/notes`)).json()) as unknown[];
    expect(notes).toHaveLength(5);
  });

  it("holds notes with links for review", async () => {
    const res = await post(`/entries/${lamps}/notes`, { body: "cheap pills at http://spam.example" });
    expect(((await res.json()) as { pending: boolean }).pending).toBe(true);
  });

  it("rejects an empty note", async () => {
    expect((await post(`/entries/${lamps}/notes`, { body: "" })).status).toBe(400);
  });

  it("keeps a guestbook per diary, and none that belongs to nobody", async () => {
    await post("/guestbook", { body: "for lan only", owner: "lan" });
    const lans = (await (await call("/guestbook?owner=lan")).json()) as Array<{ body: string }>;
    const mine = (await (await call("/guestbook?owner=4me")).json()) as Array<{ body: string }>;
    expect(lans.map((s) => s.body)).toContain("for lan only");
    expect(mine.map((s) => s.body)).not.toContain("for lan only");
    expect(await (await call("/guestbook")).json()).toEqual([]);
    expect((await post("/guestbook", { body: "hello?" })).status).toBe(400);
    expect((await post("/guestbook", { body: "hello?", owner: "nobody" })).status).toBe(404);
  });

  it("rate-limits one visitor", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await post("/guestbook", { body: `shout ${i}`, owner: "lan" }, { ip: "10.9.9.9" })).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("counters", () => {
  it("counts a read once per visitor per half hour", async () => {
    const read = async () =>
      (
        (await (await call(`/entries/${lamps}/read`, { method: "POST", ip: "10.1.1.1" })).json()) as {
          readCount: number;
        }
      ).readCount;
    expect(await read()).toBe(await read());
  });

  it("buzzes and feeds Ink", async () => {
    const buzz = (await (await call(`/entries/${lamps}/buzz`, { method: "POST" })).json()) as { buzzCount: number };
    expect(buzz.buzzCount).toBe(1);
    const cat = (await (await call("/cat/feed", { method: "POST" })).json()) as { fish: number };
    expect(cat.fish).toBe(319);
    expect((await call("/cat/dance", { method: "POST" })).status).toBe(404);
  });

  it("sweeps rate-limit windows that ended over a day ago", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.insert(schema.rateHits).values([
      { key: "old", window: now - 90_000, count: 3 },
      { key: "fresh", window: now - 60, count: 1 },
    ]);
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    await call(`/entries/${lamps}/buzz`, { method: "POST" });
    roll.mockRestore();
    expect(await db.select().from(schema.rateHits).where(eq(schema.rateHits.key, "old"))).toHaveLength(0);
    expect(await db.select().from(schema.rateHits).where(eq(schema.rateHits.key, "fresh"))).toHaveLength(1);
  });
});

describe("reports and moderation", () => {
  it("hides a page once three different readers report it, until the moderator keeps it", async () => {
    const [tram] = await db
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(eq(schema.entries.slug, "the-last-tram"));
    const report = (ip: string) => post(`/entries/${tram!.id}/report`, { reason: "spam" }, { ip });
    await report("10.5.0.1");
    await report("10.5.0.1"); // the same reader twice counts once
    await report("10.5.0.2");
    expect((await call("/entries/by/lan/the-last-tram")).status).toBe(200);
    await report("10.5.0.3");
    expect((await call("/entries/by/lan/the-last-tram")).status).toBe(404);

    const queue = (await (await call("/admin/reports", { admin: true })).json()) as Array<{
      id: number;
      count: number;
      reasons: string[];
    }>;
    expect(queue[0]).toMatchObject({ id: tram!.id, count: 3, reasons: ["spam"] });

    const keep = await call(`/admin/entries/${tram!.id}`, {
      method: "PATCH",
      admin: true,
      body: JSON.stringify({ status: "visible" }),
    });
    expect(keep.status).toBe(200);
    expect((await call("/entries/by/lan/the-last-tram")).status).toBe(200);
    expect((await (await call("/admin/reports", { admin: true })).json()) as unknown[]).toHaveLength(0);
  });

  it("closes a suspended member's desktop and pages", async () => {
    const [lan] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.handle, "lan"));
    const suspend = (status: string) =>
      call(`/admin/users/${lan!.id}`, { method: "PATCH", admin: true, body: JSON.stringify({ status }) });
    await suspend("suspended");
    expect((await call("/profiles/lan")).status).toBe(404);
    expect((await call("/entries/by/lan/the-last-tram")).status).toBe(404);
    await suspend("active");
    expect((await call("/profiles/lan")).status).toBe(200);
  });

  it("refuses the moderator's routes without the token", async () => {
    expect((await call("/admin/reports")).status).toBe(401);
    expect((await call("/admin/users", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });
});

describe("cors", () => {
  it("allows the web origin only", async () => {
    const ok = await call("/entries", { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const no = await call("/entries", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});
