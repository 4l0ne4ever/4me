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

function call(path: string, init: RequestInit & { ip?: string; admin?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `10.0.0.${++ipCounter}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.admin) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  return app.request(path, { ...init, headers }, env);
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(() => db);
});

describe("public reading", () => {
  it("lists public entries newest first", async () => {
    const res = await call("/entries");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ slug: string; noteCount: number }>;
    expect(list[0]?.slug).toBe("the-lamps-came-on-early");
    expect(list[0]?.noteCount).toBe(4);
  });

  it("returns the latest entry in full", async () => {
    const res = await call("/entries/latest");
    const entry = (await res.json()) as { title: string; song: { artist: string }; photos: unknown[] };
    expect(entry.title).toBe("The lamps came on before I got home");
    expect(entry.song.artist).toBe("Radiohead");
    expect(entry.photos).toHaveLength(2);
  });

  it("404s an unknown slug", async () => {
    expect((await call("/entries/nope")).status).toBe(404);
  });
});

describe("notes and the guestbook", () => {
  it("accepts a note and shows it", async () => {
    const res = await call("/entries/the-lamps-came-on-early/notes", {
      method: "POST",
      body: JSON.stringify({ name: "", body: "hi from the test" }),
    });
    expect(res.status).toBe(201);
    const { note, pending } = (await res.json()) as { note: { name: string }; pending: boolean };
    expect(note.name).toBe("a stranger");
    expect(pending).toBe(false);
    const notes = (await (await call("/entries/the-lamps-came-on-early/notes")).json()) as unknown[];
    expect(notes).toHaveLength(5);
  });

  it("holds notes with links for review", async () => {
    const res = await call("/entries/the-lamps-came-on-early/notes", {
      method: "POST",
      body: JSON.stringify({ body: "cheap pills at http://spam.example" }),
    });
    expect(((await res.json()) as { pending: boolean }).pending).toBe(true);
  });

  it("rejects an empty note", async () => {
    const res = await call("/entries/the-lamps-came-on-early/notes", {
      method: "POST",
      body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("rate-limits one visitor", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call("/guestbook", {
        method: "POST",
        ip: "10.9.9.9",
        body: JSON.stringify({ body: `shout ${i}` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("counters", () => {
  it("counts a read once per visitor per half hour", async () => {
    const a = (await (
      await call("/entries/thirteen-minutes-to-three/read", { method: "POST", ip: "10.1.1.1" })
    ).json()) as {
      readCount: number;
    };
    const b = (await (
      await call("/entries/thirteen-minutes-to-three/read", { method: "POST", ip: "10.1.1.1" })
    ).json()) as {
      readCount: number;
    };
    expect(b.readCount).toBe(a.readCount);
  });

  it("buzzes and feeds Ink", async () => {
    const buzz = (await (await call("/entries/the-lamps-came-on-early/buzz", { method: "POST" })).json()) as {
      buzzCount: number;
    };
    expect(buzz.buzzCount).toBe(1);
    const cat = (await (await call("/cat/feed", { method: "POST" })).json()) as { fish: number };
    expect(cat.fish).toBe(319);
    expect((await call("/cat/dance", { method: "POST" })).status).toBe(404);
  });

  it("sweeps rate-limit windows that ended over an hour ago", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.insert(schema.rateHits).values([
      { key: "old", window: now - 7200, count: 3 },
      { key: "fresh", window: now - 60, count: 1 },
    ]);
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    await call("/entries/the-lamps-came-on-early/buzz", { method: "POST" });
    roll.mockRestore();
    expect(await db.select().from(schema.rateHits).where(eq(schema.rateHits.key, "old"))).toHaveLength(0);
    expect(await db.select().from(schema.rateHits).where(eq(schema.rateHits.key, "fresh"))).toHaveLength(1);
  });
});

describe("author routes", () => {
  it("refuses without the token", async () => {
    expect((await call("/admin/entries")).status).toBe(401);
    expect((await call("/admin/entries", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("writes a private entry that readers cannot see", async () => {
    const res = await call("/admin/entries", {
      method: "POST",
      admin: true,
      body: JSON.stringify({
        title: "Mưa rồi, không ai đón",
        body: "just for me",
        visibility: "private",
        writtenAt: "2026-10-18T21:00:00+07:00",
      }),
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { slug: string; id: number };
    expect(entry.slug).toBe("2026-10-18-mua-roi-khong-ai-don");
    expect((await call(`/entries/${entry.slug}`)).status).toBe(404);
    const dup = await call("/admin/entries", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ title: "again", body: "x", slug: entry.slug }),
    });
    expect(dup.status).toBe(409);
  });

  it("posts a blast that shows first", async () => {
    await call("/admin/blasts", { method: "POST", admin: true, body: JSON.stringify({ body: "testing, testing" }) });
    const blasts = (await (await call("/blasts")).json()) as Array<{ body: string }>;
    expect(blasts[0]?.body).toBe("testing, testing");
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
