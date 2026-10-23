import {
  type EntrySummary,
  type NightEvent,
  type NightLine,
  type NightPlan,
  type NightSky,
  nightOf,
  nightShift,
} from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;
function call(path: string, init: RequestInit & { ip?: string; internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `198.18.0.${++n % 250}`);
  if (init.internal !== false) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const post = (path: string, body: unknown, extra: { ip?: string; internal?: boolean } = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), ...extra });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

type Who = { id: number; handle: string };
let owl: Who;
const tonight = nightOf(new Date());

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(() => db);
  owl = await json<Who>(post("/internal/users", { email: "owl@x.co", displayName: "Owl", passwordHash: HASH }));
});

describe("tonight's question", () => {
  it("files a page that answers it under tonight, and lists the answers", async () => {
    const res = await post(`/internal/users/${owl.id}/entries`, {
      title: "What I didn't say",
      body: "that I was fine.",
      mood: "tired",
      answering: true,
    });
    expect(((await res.json()) as EntrySummary).prompt).toBe(tonight);
    const answers = await json<EntrySummary[]>(call(`/entries?prompt=${tonight}`, { internal: false }));
    expect(answers.map((e) => e.title)).toEqual(["What I didn't say"]);
  });
});

describe("turning to a random page", () => {
  it("opens a public page", async () => {
    const page = await json<{ handle: string; slug: string; title: string }>(
      call("/entries/random", { internal: false }),
    );
    expect(page.slug).toBeTruthy();
    expect((await call(`/entries/by/${page.handle}/${page.slug}`, { internal: false })).status).toBe(200);
  });

  it("gives the screensaver short single sentences, each with its page", async () => {
    const lines = await json<Array<{ text: string; href: string }>>(call("/entries/lines", { internal: false }));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.text.length).toBeLessThanOrEqual(110);
      expect(l.href).toMatch(/^\/u\//);
    }
  });
});

describe("tonight's sky", () => {
  it("counts tonight's moods by family", async () => {
    const sky = await json<NightSky>(call(`/nights/${tonight}/sky`, { internal: false }));
    expect(sky.total).toBeGreaterThan(0);
    expect(sky.tones.find((t) => t.tone === "tired")?.count).toBeGreaterThan(0);
  });
});

describe("tonight's shared poem", () => {
  it("takes one line per person per night, from guests and members, and no links", async () => {
    const guest = await post(
      "/nights/lines",
      { name: "moth", body: "the fan turns and turns" },
      { ip: "203.0.113.70", internal: false },
    );
    expect(guest.status).toBe(201);
    const again = await post(
      "/nights/lines",
      { name: "moth", body: "and turns" },
      { ip: "203.0.113.70", internal: false },
    );
    expect(again.status).toBe(409);
    expect(
      (await post(`/internal/users/${owl.id}/lines`, { body: "someone is frying garlic downstairs" })).status,
    ).toBe(201);
    expect((await post(`/internal/users/${owl.id}/lines`, { body: "twice" })).status).toBe(409);
    const spam = await post(
      "/nights/lines",
      { name: "x", body: "visit www.spam.com now" },
      { ip: "203.0.113.71", internal: false },
    );
    expect(spam.status).toBe(400);
    const lines = await json<NightLine[]>(call(`/nights/${tonight}/lines`, { internal: false }));
    expect(lines.map((l) => l.body)).toEqual(["the fan turns and turns", "someone is frying garlic downstairs"]);
    expect(lines[1]?.member?.handle).toBe(owl.handle);
  });
});

describe("this night a year ago", () => {
  it("finds the member's pages from the same night a year, and a month, before", async () => {
    // 22:00 in Vietnam on the same date, a year back
    const yearAgo = `${Number(tonight.slice(0, 4)) - 1}${tonight.slice(4)}T22:00:00+07:00`;
    await post(`/internal/users/${owl.id}/entries`, { title: "Last year", body: "rain.", writtenAt: yearAgo });
    await post(`/internal/users/${owl.id}/entries`, {
      title: "Not that night",
      body: "dry.",
      writtenAt: `${nightShift(tonight, -400)}T22:00:00+07:00`,
    });
    const found = await json<{ year: Array<{ title: string }>; month: unknown[] }>(
      call(`/internal/users/${owl.id}/on-this-night`),
    );
    expect(found.year.map((e) => e.title)).toEqual(["Last year"]);
  });
});

describe("the nights the moderator hosts", () => {
  const tomorrow = nightShift(tonight, 1);

  it("plans one a night, never a past one, and tells everyone the night before", async () => {
    const res = await post("/admin/nights", {
      night: tomorrow,
      title: "Night shift",
      body: "Write for 45 minutes with everyone.",
      start: "23:00",
      minutes: 45,
      shift: true,
    });
    expect(res.status).toBe(201);
    const ev = (await res.json()) as NightEvent;
    expect(ev.startsAt).toBe(`${tomorrow}T16:00:00.000Z`);
    expect(ev.endsAt).toBe(`${tomorrow}T16:45:00.000Z`);
    expect((await post("/admin/nights", { night: tomorrow, title: "Again" })).status).toBe(409);
    expect((await post("/admin/nights", { night: nightShift(tonight, -2), title: "Late" })).status).toBe(400);
    expect(
      (await post("/admin/nights", { night: tomorrow, title: "x", shift: true }, { internal: false })).status,
    ).toBe(401);
    const plan = await json<NightPlan>(call(`/nights/${tonight}/plan`, { internal: false }));
    expect(plan.next?.title).toBe("Night shift");
    expect(plan.event).toBeNull();
  });

  it("seals the pages written in a night shift until it ends, and lists them together", async () => {
    const endsAt = new Date(Date.now() + 40 * 60_000);
    const [ev] = await db
      .insert(schema.nightEvents)
      .values({
        night: tonight,
        title: "Night shift",
        startsAt: new Date(Date.now() - 5 * 60_000),
        endsAt,
        shift: true,
      })
      .returning();
    const page = await json<EntrySummary>(
      post(`/internal/users/${owl.id}/entries`, { title: "On the shift", body: "the fan, again.", shift: ev!.id }),
    );
    expect(page.shift).toBe(ev!.id);
    expect(page.sealedUntil).toBe(endsAt.toISOString());
    const listed = await json<EntrySummary[]>(call(`/entries?shift=${ev!.id}`, { internal: false }));
    expect(listed.map((e) => e.title)).toEqual(["On the shift"]);
    expect(listed[0]?.sealedUntil).toBeTruthy();
  });
});
