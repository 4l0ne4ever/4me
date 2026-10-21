import type { ChatMessage, Conversation, LiveEvent } from "@4me/shared";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings, Live } from "../src/env";
import { seedIfEmpty } from "../src/seed";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const sent: Array<{ topics: string[]; event: LiveEvent }> = [];
const recorder: Live = { publish: (topics, event) => void sent.push({ topics, event }) };

let app: ReturnType<typeof createApp>;
let db: DB;
let n = 0;

function call(path: string, init: RequestInit & { internal?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++n % 250}`);
  if (init.internal !== false) headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
}
const send = (method: string, path: string, body?: unknown) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

type Who = { id: number; handle: string };
let mai: Who;
let khoa: Who;
let vy: Who;
let tam: Who;

const member = (name: string) =>
  json<Who>(send("POST", "/internal/users", { email: `${name}@x.co`, displayName: name, passwordHash: HASH }));
const chats = (u: Who) => json<Conversation[]>(call(`/internal/users/${u.id}/chats`));

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
    () => recorder,
  );
  mai = await member("Mai");
  khoa = await member("Khoa");
  vy = await member("Vy");
  tam = await member("Tam");
});
beforeEach(() => {
  sent.length = 0;
});

describe("messages between two people", () => {
  let talk: Conversation;

  it("starts a conversation, delivers a message live to both, and counts it unread for the other", async () => {
    const res = await send("POST", `/internal/users/${mai.id}/chats`, { with: [khoa.handle] });
    expect(res.status).toBe(201);
    talk = (await res.json()) as Conversation;
    expect(talk.group).toBe(false);
    expect(talk.members.map((m) => m.handle).sort()).toEqual([khoa.handle, mai.handle].sort());

    const msg = await json<ChatMessage>(
      send("POST", `/internal/users/${mai.id}/chats/${talk.id}/messages`, { body: "hi" }),
    );
    expect(msg).toMatchObject({ body: "hi", kind: "text", from: { handle: mai.handle } });
    expect(sent.find((s) => s.event.type === "message")?.topics.sort()).toEqual(
      [`user:${khoa.id}`, `user:${mai.id}`].sort(),
    );
    const [forKhoa] = await chats(khoa);
    expect(forKhoa).toMatchObject({ id: talk.id, unread: 1, last: { body: "hi" } });
    const [forMai] = await chats(mai);
    expect(forMai!.unread).toBe(0);
  });

  it("keeps one conversation per pair, whoever starts it", async () => {
    const again = await json<Conversation>(send("POST", `/internal/users/${khoa.id}/chats`, { with: [mai.handle] }));
    expect(again.id).toBe(talk.id);
  });

  it("clears unread once read", async () => {
    await send("POST", `/internal/users/${khoa.id}/chats/${talk.id}/read`);
    expect((await chats(khoa))[0]!.unread).toBe(0);
  });

  it("is invisible to anyone outside it", async () => {
    expect((await call(`/internal/users/${vy.id}/chats/${talk.id}/messages`)).status).toBe(404);
    expect((await send("POST", `/internal/users/${vy.id}/chats/${talk.id}/messages`, { body: "x" })).status).toBe(404);
    expect(await chats(vy)).toEqual([]);
  });

  it("lets either person block the other, both ways, until unblocked", async () => {
    await send("POST", `/internal/users/${khoa.id}/blocks`, { handle: mai.handle, on: true });
    expect((await send("POST", `/internal/users/${mai.id}/chats/${talk.id}/messages`, { body: "?" })).status).toBe(403);
    expect((await send("POST", `/internal/users/${khoa.id}/chats/${talk.id}/messages`, { body: "?" })).status).toBe(
      403,
    );
    expect((await chats(khoa))[0]!.blocked).toBe(true);
    await send("POST", `/internal/users/${khoa.id}/blocks`, { handle: mai.handle, on: false });
    expect((await send("POST", `/internal/users/${mai.id}/chats/${talk.id}/messages`, { body: "ok" })).status).toBe(
      201,
    );
  });

  it("refuses an empty message, and nobody can message themselves", async () => {
    expect((await send("POST", `/internal/users/${mai.id}/chats/${talk.id}/messages`, { body: " " })).status).toBe(400);
    expect((await send("POST", `/internal/users/${mai.id}/chats`, { with: [mai.handle] })).status).toBe(404);
  });
});

describe("groups", () => {
  let group: Conversation;

  it("starts a named group with a line saying who is in it", async () => {
    const res = await send("POST", `/internal/users/${mai.id}/chats`, {
      with: [khoa.handle, vy.handle],
      title: "night shift",
    });
    group = (await res.json()) as Conversation;
    expect(group).toMatchObject({ group: true, title: "night shift" });
    expect(group.members).toHaveLength(3);
    const lines = await json<ChatMessage[]>(call(`/internal/users/${vy.id}/chats/${group.id}/messages`));
    expect(lines[0]).toMatchObject({ kind: "system", body: "Mai started a group with Khoa and Vy" });
  });

  it("lets anyone in it bring someone in, and anyone leave", async () => {
    const more = await json<Conversation>(
      send("POST", `/internal/users/${khoa.id}/chats/${group.id}/people`, { with: [tam.handle] }),
    );
    expect(more.members).toHaveLength(4);
    expect((await send("POST", `/internal/users/${vy.id}/chats/${group.id}/leave`)).status).toBe(200);
    expect((await call(`/internal/users/${vy.id}/chats/${group.id}/messages`)).status).toBe(404);
    const lines = await json<ChatMessage[]>(call(`/internal/users/${tam.id}/chats/${group.id}/messages`));
    expect(lines.map((l) => l.body)).toEqual(["Mai started a group with Khoa and Vy", "Khoa added Tam", "Vy left"]);
  });

  it("sends a BUZZ to everyone in it", async () => {
    await send("POST", `/internal/users/${tam.id}/chats/${group.id}/buzz`);
    const buzz = sent.find((s) => s.event.type === "message");
    expect(buzz?.topics).toHaveLength(3);
    expect(buzz?.event).toMatchObject({ message: { kind: "buzz", from: { handle: tam.handle } } });
  });

  it("can't be left by two people talking alone", async () => {
    const [pair] = (await chats(mai)).filter((c) => !c.group);
    expect((await send("POST", `/internal/users/${mai.id}/chats/${pair!.id}/leave`)).status).toBe(400);
  });
});
