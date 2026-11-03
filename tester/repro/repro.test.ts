// QA reproductions against an in-memory PGlite. Nothing here touches a real database or service.
// Each case prints what it saw; they "pass" either way, they are evidence, not regression tests. Run: bash run.sh
import type { Digest, Me } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app";
import * as schema from "../../apps/api/src/db/schema";
import type { DB } from "../../apps/api/src/db/types";
import type { Bindings } from "../../apps/api/src/env";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH_A = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$YXR0YWNrZXJhdHRhY2tlcg";
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;
function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `203.0.113.${++n % 250}`);
  headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
type Who = Me & { id: number; sessionVersion: number };
const user = (email: string, displayName: string, passwordHash = HASH) =>
  json<Who>(send("POST", "/internal/users", { email, displayName, passwordHash }));
const bell = async (id: number) =>
  (await json<{ items: { kind: string; text: string }[] }>(call(`/internal/users/${id}/notifications`))).items;
async function verify(id: number) {
  const { token } = await json<{ token: string }>(send("POST", `/internal/users/${id}/email-check`));
  await send("POST", "/internal/email-checks/consume", { token });
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, {
    migrationsFolder: new URL("../../apps/api/drizzle", import.meta.url).pathname,
  });
  app = createApp(() => db);
});

describe("QA-1 draft -> public", () => {
  it("does a page published later reach subscribers?", async () => {
    const w = await user("w1@x.co", "Writer One");
    const r = await user("r1@x.co", "Reader One");
    await verify(r.id);
    await send("POST", `/internal/users/${r.id}/subscriptions/${w.handle}`);
    await send("PATCH", `/internal/users/${r.id}`, { emailDigest: true });
    // A draft started three nights ago, finished and published now.
    const written = new Date(Date.now() - 3 * 86400_000).toISOString();
    const draft = await json<{ id: number }>(
      send("POST", `/internal/users/${w.id}/entries`, {
        title: "Finished at last",
        body: "words",
        visibility: "draft",
        writtenAt: written,
      }),
    );
    const put = await send("PUT", `/internal/users/${w.id}/entries/${draft.id}`, {
      title: "Finished at last",
      body: "words",
      visibility: "public",
      writtenAt: written,
    });
    expect(put.status).toBe(200);
    const posts = (await bell(r.id)).filter((b) => b.kind === "post");
    const digest = await json<{ due: Digest[] }>(call("/internal/digests"));
    const mine = digest.due.find((d) => d.userId === r.id);
    console.log("QA-1 bell 'post' notifications:", posts.length, "| digest pages for reader:", mine?.pages.length ?? 0);
    // Also: a draft published the same night it was written.
    const d2 = await json<{ id: number }>(
      send("POST", `/internal/users/${w.id}/entries`, { title: "Tonight", body: "x", visibility: "draft" }),
    );
    await send("PUT", `/internal/users/${w.id}/entries/${d2.id}`, {
      title: "Tonight",
      body: "x",
      visibility: "public",
    });
    const posts2 = (await bell(r.id)).filter((b) => b.kind === "post");
    console.log("QA-1b bell 'post' after same-night draft published:", posts2.length);
  });
});

describe("QA-2 a long-sealed letter and the morning email", () => {
  it("is an opened letter in the digest?", async () => {
    const w = await user("w2@x.co", "Writer Two");
    const r = await user("r2@x.co", "Reader Two");
    await verify(r.id);
    await send("POST", `/internal/users/${r.id}/subscriptions/${w.handle}`);
    await send("PATCH", `/internal/users/${r.id}`, { emailDigest: true });
    const opens = new Date(Date.now() + 3600_000).toISOString();
    const letter = await json<{ id: number }>(
      send("POST", `/internal/users/${w.id}/entries`, { title: "To me in a month", body: "hello", opensAt: opens }),
    );
    // Time passes: it was written 30 days ago and its day came a minute ago.
    await db
      .update(schema.entries)
      .set({
        writtenAt: sql`now() - interval '30 days'`,
        opensAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(schema.entries.id, letter.id));
    // Subscribed before it was written.
    await db
      .update(schema.follows)
      .set({ createdAt: sql`now() - interval '60 days'` })
      .where(eq(schema.follows.followerId, r.id));
    await send("POST", "/internal/letters/open");
    const opened = (await bell(r.id)).filter((b) => b.kind === "opened");
    const digest = await json<{ due: Digest[] }>(call("/internal/digests"));
    const mine = digest.due.find((d) => d.userId === r.id);
    console.log("QA-2 bell 'opened':", opened.length, "| digest pages:", mine?.pages.map((p) => p.title) ?? []);
  });
});

describe("QA-3 an unconfirmed password account and Google", () => {
  it("does Google link to an account someone else made with that address?", async () => {
    // Someone registers the address first, with a password they know, and never confirms it.
    const squatter = await user("victim@gmail.com", "Squatter", HASH_A);
    expect(squatter.emailVerified).toBe(false);
    // The address's real owner later signs in with Google (Google has verified the address).
    const viaGoogle = await json<Who>(
      send("POST", "/internal/oauth/google", {
        sub: "google-sub-123",
        email: "victim@gmail.com",
        emailVerified: true,
        name: "Real Owner",
      }),
    );
    const signIn = await json<{ user: { id: number; passwordHash: string; sessionVersion: number } | null }>(
      send("POST", "/internal/sign-in", { email: "victim@gmail.com" }),
    );
    console.log(
      "QA-3 same account:",
      viaGoogle.id === squatter.id,
      "| verified now:",
      viaGoogle.emailVerified,
      "| squatter's password still works:",
      signIn.user?.passwordHash === HASH_A,
      "| sessionVersion unchanged:",
      viaGoogle.sessionVersion === squatter.sessionVersion,
      "| name shown:",
      viaGoogle.displayName,
    );
  });
});

describe("QA-4 group history", () => {
  it("does someone added to a group read what was said before they came?", async () => {
    const a = await user("a4@x.co", "Ann Four");
    const b = await user("b4@x.co", "Ben Four");
    const c = await user("c4@x.co", "Cat Four");
    const d = await user("d4@x.co", "Dan Four");
    const conv = await json<{ id: number }>(
      send("POST", `/internal/users/${a.id}/chats`, { with: [b.handle, c.handle] }),
    );
    await send("POST", `/internal/users/${a.id}/chats/${conv.id}/messages`, { body: "before Dan: a secret" });
    await send("POST", `/internal/users/${a.id}/chats/${conv.id}/people`, { with: [d.handle] });
    const seen = await json<{ body: string }[]>(call(`/internal/users/${d.id}/chats/${conv.id}/messages`));
    console.log(
      "QA-4 Dan sees:",
      seen.map((m) => m.body),
    );
  });
});

describe("QA-5 note hidden by reports, approved again by the page's writer", () => {
  it("does one more report hide it again?", async () => {
    const w = await user("w5@x.co", "Writer Five");
    const page = await json<{ id: number }>(
      send("POST", `/internal/users/${w.id}/entries`, { title: "Five", body: "body" }),
    );
    const others = await Promise.all([1, 2, 3, 4].map((i) => user(`o5${i}@x.co`, `Other Five ${i}`)));
    const note = await json<{ note: { id: number } }>(
      send("POST", `/internal/users/${others[0]!.id}/notes/${page.id}`, { body: "a plain note" }),
    );
    for (const o of others.slice(1, 4))
      await send("POST", `/internal/users/${o.id}/reports/notes/${note.note.id}`, { reason: "spam" });
    const s1 = await db.select({ s: schema.notes.status }).from(schema.notes).where(eq(schema.notes.id, note.note.id));
    // The page's writer lets it back through their own inbox.
    await send("PATCH", `/internal/users/${w.id}/inbox/${note.note.id}`, { status: "visible" });
    const s2 = await db.select({ s: schema.notes.status }).from(schema.notes).where(eq(schema.notes.id, note.note.id));
    const extra = await user("o5x@x.co", "Other Five X");
    await send("POST", `/internal/users/${extra.id}/reports/notes/${note.note.id}`, { reason: "other" });
    const s3 = await db.select({ s: schema.notes.status }).from(schema.notes).where(eq(schema.notes.id, note.note.id));
    console.log("QA-5 after 3 reports:", s1[0]?.s, "| writer approves:", s2[0]?.s, "| after 1 more report:", s3[0]?.s);
  });
});

describe("QA-6 a sealed letter's mood and weather", () => {
  it("are they shown before the letter opens?", async () => {
    const w = await user("w6@x.co", "Writer Six");
    await send("POST", `/internal/users/${w.id}/entries`, {
      title: "Sealed six",
      body: "secret words",
      mood: "heartbroken",
      weather: "storm",
      slug: "sealed-six",
      opensAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    const page = await json<{ body: string; mood: string; weather: string; sealedUntil: string | null }>(
      call(`/entries/by/${w.handle}/sealed-six`),
    );
    const archive = await json<{ mood: string }[]>(call(`/archive?author=${w.handle}`));
    console.log(
      "QA-6 sealed:",
      Boolean(page.sealedUntil),
      "| body shown:",
      page.body !== "",
      "| mood:",
      page.mood,
      "| weather:",
      page.weather,
      "| archive mood:",
      JSON.stringify(archive[0]?.mood),
    );
  });
});
