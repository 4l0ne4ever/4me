import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = {
  DATABASE_URL: "pglite",
  ADMIN_TOKEN: "server-token",
  WEB_ORIGIN: "https://4me.example",
  IP_SALT: "t",
};
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
let app: ReturnType<typeof createApp>;
let n = 0;

function call(path: string, init: RequestInit & { ip?: string; internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.9");
  if (init.internal !== false) {
    headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
    headers.set("x-client-ip", init.ip ?? `198.51.100.${++n}`);
  }
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const post = (path: string, body: unknown, extra: { ip?: string; internal?: boolean } = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), ...extra });

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(() => db);
});

describe("the internal door", () => {
  it("is shut without the server token", async () => {
    expect(
      (await post("/internal/users", { email: "a@b.co", displayName: "x1", passwordHash: HASH }, { internal: false }))
        .status,
    ).toBe(401);
    expect(
      (await call("/internal/users/1", { headers: { authorization: "Bearer guess" }, internal: false })).status,
    ).toBe(401);
  });
  it("rejects anything that is not a scrypt hash", async () => {
    const res = await post("/internal/users", {
      email: "plain@b.co",
      displayName: "Plain",
      passwordHash: "hunter2hunter2",
    });
    expect(res.status).toBe(400);
  });
});

describe("accounts", () => {
  let wren: { id: number; sessionVersion: number };

  it("signs up a reader, never echoing the hash", async () => {
    const res = await post("/internal/users", { email: "Wren@Example.com", displayName: "Wren", passwordHash: HASH });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      displayName: "Wren",
      handle: "wren",
      email: "wren@example.com",
      hasPassword: true,
      google: false,
      suspended: false,
    });
    expect(JSON.stringify(body)).not.toContain("scrypt");
    wren = body as unknown as typeof wren;
  });

  it("keeps emails and names unique, names case-insensitively, and the author's name off limits", async () => {
    expect(
      (await post("/internal/users", { email: "wren@example.com", displayName: "Other", passwordHash: HASH })).status,
    ).toBe(409);
    const dupName = await post("/internal/users", { email: "w2@example.com", displayName: "wREN", passwordHash: HASH });
    expect(dupName.status).toBe(409);
    expect(((await dupName.json()) as { field: string }).field).toBe("displayName");
    expect(
      (await post("/internal/users", { email: "fake@example.com", displayName: "4me", passwordHash: HASH })).status,
    ).toBe(409);
  });

  it("hands the web server the hash for sign-in, and nothing for unknown addresses", async () => {
    const found = (await (await post("/internal/sign-in", { email: "WREN@example.com" })).json()) as {
      user: { passwordHash: string };
    };
    expect(found.user.passwordHash).toBe(HASH);
    expect(await (await post("/internal/sign-in", { email: "nobody@example.com" })).json()).toEqual({ user: null });
  });

  it("limits sign-in attempts per address, whatever the IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await post("/internal/sign-in", { email: "target@example.com" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("stops anonymous readers from writing under a member's name", async () => {
    const res = await post("/guestbook", { name: "wren", body: "it's me, honest", owner: "lan" }, { internal: false });
    expect(res.status).toBe(409);
  });

  it("lets a member write under their own name, with their avatar and desktop", async () => {
    const { id: lamps } = (await (
      await call("/entries/by/4me/the-lamps-came-on-early", { internal: false })
    ).json()) as {
      id: number;
    };
    const res = await post(`/internal/users/${wren.id}/notes/${lamps}`, { body: "signed in now" });
    expect(res.status).toBe(201);
    const notes = (await (await call(`/entries/${lamps}/notes`, { internal: false })).json()) as Array<{
      name: string;
      member: { avatar: string; handle: string } | null;
    }>;
    const mine = notes.find((x) => x.name === "Wren");
    expect(mine?.member).toEqual({ avatar: "/photos/pic-229.jpg", handle: "wren" });
    expect(notes.find((x) => x.name === "grey_cloud_92")?.member).toBeNull();
    const list = (await (await call(`/internal/users/${wren.id}/notes`)).json()) as Array<{ handle: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.handle).toBe("4me");
  });

  it("changes the profile and syncs Ink", async () => {
    const res = await call(`/internal/users/${wren.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        avatar: "red-coat",
        ink: { hunger: 50, joy: 60, at: 1_000 },
        handle: "Wren_Writes",
        bio: "tram notes",
        lastfmUser: "wrenfm",
      }),
    });
    expect(await res.json()).toMatchObject({
      avatar: "red-coat",
      ink: { hunger: 50, joy: 60 },
      handle: "wren_writes",
      bio: "tram notes",
      lastfmUser: "wrenfm",
    });
  });

  it("keeps how a member dressed their Ink, and refuses colours that aren't colours", async () => {
    const look = { name: "Mochi", fur: "#D07A35", eyes: "#8fd16a", collar: "#2f9c95", outfit: "season" };
    const res = await call(`/internal/users/${wren.id}`, { method: "PATCH", body: JSON.stringify({ inkLook: look }) });
    // An older look without a kind of cat is a shorthair.
    expect(((await res.json()) as { inkLook: unknown }).inkLook).toEqual({
      ...look,
      fur: "#d07a35",
      breed: "shorthair",
    });
    const bad = await call(`/internal/users/${wren.id}`, {
      method: "PATCH",
      body: JSON.stringify({ inkLook: { ...look, fur: "url(x)" } }),
    });
    expect(bad.status).toBe(400);
  });

  it("sticks a song on a member's note and shout, and only Apple's links", async () => {
    const song = {
      id: 1440833098,
      title: "No Surprises",
      artist: "Radiohead",
      coverUrl: "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/a.m4a",
      url: "https://music.apple.com/vn/album/x",
    };
    const { id: lamps } = (await (
      await call("/entries/by/4me/the-lamps-came-on-early", { internal: false })
    ).json()) as { id: number };
    const res = await post(`/internal/users/${wren.id}/notes/${lamps}`, { body: "this one, tonight", song });
    expect(res.status).toBe(201);
    const { note } = (await res.json()) as { note: { song: unknown } };
    expect(note.song).toEqual({
      title: "No Surprises",
      artist: "Radiohead",
      coverUrl: song.coverUrl,
      previewUrl: song.previewUrl,
      url: song.url,
    });
    const shout = await post(`/internal/users/${wren.id}/shouts`, { body: "hi", owner: "lan", song });
    expect(((await shout.json()) as { shout: { song: { title: string } } }).shout.song.title).toBe("No Surprises");
    const evil = await post(`/internal/users/${wren.id}/shouts`, {
      body: "hi",
      owner: "lan",
      song: { ...song, previewUrl: "https://evil.example/a.m4a" },
    });
    expect(evil.status).toBe(400);
  });

  it("keeps desktop addresses unique and off the site's own paths", async () => {
    const taken = await call(`/internal/users/${wren.id}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "lan" }),
    });
    expect(taken.status).toBe(409);
    const reserved = await call(`/internal/users/${wren.id}`, {
      method: "PATCH",
      body: JSON.stringify({ handle: "admin" }),
    });
    expect(reserved.status).toBe(400);
  });

  it("revokes sessions when the password changes", async () => {
    const res = (await (await post(`/internal/users/${wren.id}/password`, { passwordHash: HASH })).json()) as {
      sessionVersion: number;
    };
    expect(res.sessionVersion).toBe(wren.sessionVersion + 1);
  });

  it("resets a forgotten password once, with a link that only works one time", async () => {
    const { token } = (await (await post("/internal/resets", { email: "wren@example.com" })).json()) as {
      token: string;
    };
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await post("/internal/resets", { email: "ghost@example.com" })).json()).toEqual({ token: null });
    expect((await post("/internal/resets/consume", { token, passwordHash: HASH })).status).toBe(200);
    expect((await post("/internal/resets/consume", { token, passwordHash: HASH })).status).toBe(400);
  });
});

describe("Google", () => {
  it("creates an account with a free name, then finds it again", async () => {
    const first = await post("/internal/oauth/google", {
      sub: "g-1",
      email: "mai@gmail.com",
      emailVerified: true,
      name: "Wren",
    });
    expect(first.status).toBe(201);
    const me = (await first.json()) as { displayName: string; google: boolean; hasPassword: boolean };
    expect(me).toMatchObject({ displayName: "Wren 2", handle: "wren_2", google: true, hasPassword: false });
    const again = await post("/internal/oauth/google", {
      sub: "g-1",
      email: "mai@gmail.com",
      emailVerified: true,
      name: "x",
    });
    expect(again.status).toBe(200);
  });

  it("links to an existing account only for a verified address", async () => {
    await post("/internal/users", { email: "linh@example.com", displayName: "Linh", passwordHash: HASH });
    const unverified = await post("/internal/oauth/google", {
      sub: "g-2",
      email: "linh@example.com",
      emailVerified: false,
      name: "Linh",
    });
    expect(((await unverified.json()) as { displayName: string }).displayName).toBe("Linh 2");
    const verified = await post("/internal/oauth/google", {
      sub: "g-3",
      email: "linh@example.com",
      emailVerified: true,
      name: "Linh",
    });
    expect(await verified.json()).toMatchObject({ displayName: "Linh", google: true, hasPassword: true });
  });
});

describe("leaving", () => {
  it("deletes the account and unsigns their notes", async () => {
    const res = await post("/internal/users", { email: "bye@example.com", displayName: "Leaver", passwordHash: HASH });
    const { id } = (await res.json()) as { id: number };
    await post(`/internal/users/${id}/shouts`, { body: "goodbye", owner: "lan" });
    expect((await call(`/internal/users/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/internal/users/${id}`)).status).toBe(404);
    const shouts = (await (await call("/guestbook?owner=lan", { internal: false })).json()) as Array<{
      name: string;
      body: string;
      member: unknown;
    }>;
    expect(shouts.find((s) => s.body === "goodbye")).toMatchObject({ name: "a former reader", member: null });
  });
});

describe("transport", () => {
  it("asks browsers to stay on HTTPS and refuses plain-http origins", async () => {
    const res = await call("/health", { internal: false, headers: { origin: "http://4me.example" } });
    expect(res.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const ok = await call("/health", { internal: false, headers: { origin: "https://4me.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://4me.example");
  });
});
