import { signUploadTicket } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { cleanJpeg, memoryStore } from "../src/lib/media";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const media = memoryStore();
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
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown, internal = true) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), internal });

/** A tiny but well-formed JPEG carrying an EXIF block with "GPS!" in it. */
function jpegWithExif(): Uint8Array {
  const bytes = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1, 0x00, 0x0c, ...Buffer.from("Exif\0\0GPS!")],
    [0xff, 0xc0, 0x00, 0x11, 8, 0, 2, 0, 3, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x00],
    [0xff, 0xd9],
  ].flat();
  return new Uint8Array(bytes);
}

function ticket(uid: number, secret = env.ADMIN_TOKEN, now = Date.now()) {
  return signUploadTicket(uid, secret, now);
}

const upload = async (t: string | Promise<string>, body: Uint8Array = jpegWithExif(), type = "image/jpeg") =>
  app.request(
    "/uploads",
    {
      method: "POST",
      body,
      headers: { "x-upload-ticket": await t, "content-type": type, "cf-connecting-ip": "203.0.113.200" },
    },
    env,
  );

/** The iTunes API, answered locally. */
function fakeItunes() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const track = {
      kind: "song",
      trackId: 42,
      trackName: "Em Dạo Này",
      artistName: "Ngọt",
      collectionName: "3",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/a.m4a",
      trackViewUrl: "https://music.apple.com/vn/album/x?i=42",
    };
    if (url.includes("/search?"))
      return Response.json({ results: [track, { ...track, trackId: 43, previewUrl: "https://evil.example/a.m4a" }] });
    if (url.includes("/lookup?id=42")) return Response.json({ results: [track] });
    return Response.json({ results: [] });
  });
}

let mai: { id: number; handle: string };
let khoa: { id: number; handle: string };
const page = { title: "Đêm đầu tiên", body: "the first night here.\n\n> hello" };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => media,
  );
  mai = (await (
    await send("POST", "/internal/users", { email: "mai@example.com", displayName: "Mai", passwordHash: HASH })
  ).json()) as typeof mai;
  khoa = (await (
    await send("POST", "/internal/users", { email: "khoa@example.com", displayName: "Khoa", passwordHash: HASH })
  ).json()) as typeof khoa;
});

afterEach(() => vi.restoreAllMocks());

describe("writing pages", () => {
  let first: { id: number; slug: string };

  it("posts a member's page to their desktop and the front one", async () => {
    const res = await send("POST", `/internal/users/${mai.id}/entries`, {
      ...page,
      writtenAt: "2026-10-20T22:00:00+07:00",
    });
    expect(res.status).toBe(201);
    first = (await res.json()) as typeof first;
    expect(first.slug).toBe("2026-10-20-dem-dau-tien");
    const mine = (await (await call("/entries?author=mai", { internal: false })).json()) as Array<{ slug: string }>;
    expect(mine.map((e) => e.slug)).toEqual([first.slug]);
    expect((await call(`/entries/by/mai/${first.slug}`, { internal: false })).status).toBe(200);
  });

  it("gives every member their own addresses", async () => {
    const same = await send("POST", `/internal/users/${khoa.id}/entries`, { ...page, slug: first.slug });
    expect(same.status).toBe(201);
    const dup = await send("POST", `/internal/users/${mai.id}/entries`, { ...page, slug: first.slug });
    expect(dup.status).toBe(409);
  });

  it("keeps private pages and drafts off every desktop but lists them for their author", async () => {
    const res = await send("POST", `/internal/users/${mai.id}/entries`, {
      title: "only me",
      body: "x",
      visibility: "private",
    });
    const priv = (await res.json()) as { slug: string; id: number };
    expect((await call(`/entries/by/mai/${priv.slug}`, { internal: false })).status).toBe(404);
    const list = (await (await call(`/internal/users/${mai.id}/entries`)).json()) as Array<{ visibility: string }>;
    expect(list.map((e) => e.visibility).sort()).toEqual(["private", "public"]);
  });

  it("never lets one member edit, read back or delete another's page", async () => {
    expect((await send("PUT", `/internal/users/${khoa.id}/entries/${first.id}`, page)).status).toBe(404);
    expect((await call(`/internal/users/${khoa.id}/entries/${first.id}`)).status).toBe(404);
    expect((await send("DELETE", `/internal/users/${khoa.id}/entries/${first.id}`)).status).toBe(404);
    expect((await call(`/entries/by/mai/${first.slug}`, { internal: false })).status).toBe(200);
  });

  it("edits and deletes the member's own page", async () => {
    const edited = await send("PUT", `/internal/users/${mai.id}/entries/${first.id}`, { ...page, title: "renamed" });
    expect(((await edited.json()) as { title: string; slug: string }).slug).toBe(first.slug);
    const extra = (await (
      await send("POST", `/internal/users/${mai.id}/entries`, { ...page, title: "gone soon" })
    ).json()) as {
      id: number;
    };
    expect((await send("DELETE", `/internal/users/${mai.id}/entries/${extra.id}`)).status).toBe(200);
    expect((await call(`/internal/users/${mai.id}/entries/${extra.id}`)).status).toBe(404);
  });

  it("keeps blasts and binned lines per member", async () => {
    await send("POST", `/internal/users/${mai.id}/blasts`, { body: "first blast" });
    await send("POST", `/internal/users/${mai.id}/almost`, { body: "never mind" });
    const blasts = (await (await call("/blasts?author=mai", { internal: false })).json()) as Array<{
      body: string;
      id: number;
    }>;
    expect(blasts.map((b) => b.body)).toEqual(["first blast"]);
    expect(((await (await call("/almost?author=mai", { internal: false })).json()) as unknown[]).length).toBe(1);
    expect(((await (await call("/blasts?author=khoa", { internal: false })).json()) as unknown[]).length).toBe(0);
    expect((await send("DELETE", `/internal/users/${khoa.id}/blasts/${blasts[0]!.id}`)).status).toBe(404);
  });
});

describe("music", () => {
  it("searches, and never passes on audio from anywhere but Apple", async () => {
    fakeItunes();
    const hits = (await (await call("/music/search?q=ngot", { internal: false })).json()) as Array<{
      id: number;
      previewUrl: string | null;
      coverUrl: string;
    }>;
    expect(hits[0]).toMatchObject({ id: 42, coverUrl: expect.stringContaining("600x600bb") });
    expect(hits[1]?.previewUrl).toBeNull();
  });

  it("looks a picked song up again by its id and stores its preview", async () => {
    fakeItunes();
    const res = await send("POST", `/internal/users/${mai.id}/entries`, { ...page, title: "with a song", songId: 42 });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { song: { title: string; previewUrl: string } };
    expect(entry.song).toMatchObject({
      title: "Em Dạo Này",
      previewUrl: expect.stringContaining("audio-ssl.itunes.apple.com"),
    });
    const missing = await send("POST", `/internal/users/${mai.id}/entries`, { ...page, title: "lost", songId: 7 });
    expect(missing.status).toBe(400);
  });
});

describe("photos", () => {
  it("strips EXIF and GPS from the JPEG before storing it", () => {
    const clean = cleanJpeg(jpegWithExif());
    expect(clean).toMatchObject({ width: 3, height: 2 });
    expect(Buffer.from(clean!.bytes).includes("GPS!")).toBe(false);
    expect(Buffer.from(clean!.bytes).includes("JFIF")).toBe(true);
    expect(cleanJpeg(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("needs a valid ticket and a JPEG", async () => {
    expect((await upload("")).status).toBe(401);
    expect((await upload(ticket(mai.id, "wrong-secret"))).status).toBe(401);
    expect((await upload(ticket(mai.id, env.ADMIN_TOKEN, Date.now() - 11 * 60_000))).status).toBe(401);
    expect((await upload(ticket(mai.id), new TextEncoder().encode("GIF89a"), "image/gif")).status).toBe(415);
  });

  it("stores the photo, serves it to other sites, and only lets its owner use it", async () => {
    const res = await upload(ticket(mai.id));
    expect(res.status).toBe(201);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(new RegExp(`^/media/u/${mai.id}/[a-z0-9-]+\\.jpg$`));

    const served = await call(path, { internal: false });
    expect(served.status).toBe(200);
    expect(served.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(Buffer.from(await served.arrayBuffer()).includes("GPS!")).toBe(false);

    const stolen = await send("POST", `/internal/users/${khoa.id}/entries`, { ...page, photos: [{ url: path }] });
    expect(stolen.status).toBe(400);
    const fake = await send("POST", `/internal/users/${mai.id}/entries`, {
      ...page,
      photos: [{ url: `/media/u/${mai.id}/00000000-0000-0000-0000-000000000000.jpg` }],
    });
    expect(fake.status).toBe(400);

    const made = await send("POST", `/internal/users/${mai.id}/entries`, {
      ...page,
      title: "with a photo",
      photos: [{ url: path, caption: "the window" }],
    });
    const entry = (await made.json()) as { id: number; photos: Array<{ url: string }> };
    expect(entry.photos[0]?.url).toBe(`http://localhost${path}`);

    // Deleting the page deletes the photo it carried.
    await send("DELETE", `/internal/users/${mai.id}/entries/${entry.id}`);
    expect((await call(path, { internal: false })).status).toBe(404);
  });
});

describe("notes on a member's page", () => {
  it("lands in their inbox, where links wait for them to approve", async () => {
    const made = (await (
      await send("POST", `/internal/users/${khoa.id}/entries`, { ...page, title: "inbox test" })
    ).json()) as {
      id: number;
    };
    await send("POST", `/entries/${made.id}/notes`, { name: "guest", body: "see http://x.example" }, false);
    const inbox = (await (await call(`/internal/users/${khoa.id}/inbox`)).json()) as Array<{
      id: number;
      status: string;
    }>;
    expect(inbox[0]?.status).toBe("pending");
    // Only the page's author may approve it.
    expect((await send("PATCH", `/internal/users/${mai.id}/inbox/${inbox[0]!.id}`, { status: "visible" })).status).toBe(
      404,
    );
    expect(
      (await send("PATCH", `/internal/users/${khoa.id}/inbox/${inbox[0]!.id}`, { status: "visible" })).status,
    ).toBe(200);
    const notes = (await (await call(`/entries/${made.id}/notes`, { internal: false })).json()) as unknown[];
    expect(notes).toHaveLength(1);

    // The author answering on their own page is marked as the author.
    const reply = (await (
      await send("POST", `/internal/users/${khoa.id}/notes/${made.id}`, { body: "thanks" })
    ).json()) as {
      note: { isAuthor: boolean };
    };
    expect(reply.note.isAuthor).toBe(true);
  });

  it("lets members report other people's pages, not their own", async () => {
    const [own] = (await (await call(`/internal/users/${khoa.id}/entries`)).json()) as Array<{ id: number }>;
    expect((await send("POST", `/internal/users/${khoa.id}/reports/${own!.id}`, { reason: "spam" })).status).toBe(400);
    expect((await send("POST", `/internal/users/${mai.id}/reports/${own!.id}`, { reason: "spam" })).status).toBe(200);
  });
});

describe("suspension", () => {
  it("stops a suspended member writing or uploading, and closes their pages", async () => {
    const set = (status: string) =>
      call(`/admin/users/${khoa.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await set("suspended");
    expect((await send("POST", `/internal/users/${khoa.id}/entries`, page)).status).toBe(403);
    expect((await send("POST", `/internal/users/${khoa.id}/blasts`, { body: "x" })).status).toBe(403);
    expect((await upload(ticket(khoa.id))).status).toBe(403);
    expect(((await (await call("/entries?author=khoa", { internal: false })).json()) as unknown[]).length).toBe(0);
    const me = (await (await call(`/internal/users/${khoa.id}`)).json()) as { suspended: boolean };
    expect(me.suspended).toBe(true);
    await set("active");
  });
});

describe("leaving", () => {
  it("deletes a member's pages and photos with their account", async () => {
    const { path } = (await (await upload(ticket(mai.id))).json()) as { path: string };
    await send("POST", `/internal/users/${mai.id}/entries`, { ...page, title: "last", photos: [{ url: path }] });
    expect((await send("DELETE", `/internal/users/${mai.id}`)).status).toBe(200);
    expect((await call(path, { internal: false })).status).toBe(404);
    expect(((await (await call("/entries?author=mai", { internal: false })).json()) as unknown[]).length).toBe(0);
    const left = await db.select().from(schema.uploads).where(eq(schema.uploads.userId, mai.id));
    expect(left).toHaveLength(0);
  });
});
