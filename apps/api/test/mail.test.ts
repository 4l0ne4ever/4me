import type { Digest, Me } from "@4me/shared";
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

type Who = Me & { id: number };
let reader: Who;
let writer: Who;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedIfEmpty(db);
  app = createApp(
    () => db,
    () => null,
  );
  reader = await json<Who>(
    send("POST", "/internal/users", { email: "owl@x.co", displayName: "Owl", passwordHash: HASH }),
  );
  writer = await json<Who>(
    send("POST", "/internal/users", { email: "fern@x.co", displayName: "Fern", passwordHash: HASH }),
  );
});

describe("proving an address", () => {
  let token: string;

  it("starts unproven for a password account, and makes a one-day link", async () => {
    expect(reader.emailVerified).toBe(false);
    const res = await json<{ token: string; email: string }>(send("POST", `/internal/users/${reader.id}/email-check`));
    expect(res.email).toBe("owl@x.co");
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    token = res.token;
  });

  it("proves the address once, and the link never works again", async () => {
    expect((await send("POST", "/internal/email-checks/consume", { token })).status).toBe(200);
    const me = await json<Me>(call(`/internal/users/${reader.id}`));
    expect(me.emailVerified).toBe(true);
    expect((await send("POST", "/internal/email-checks/consume", { token })).status).toBe(400);
    expect(await json(send("POST", `/internal/users/${reader.id}/email-check`))).toEqual({ verified: true });
  });

  it("counts a used reset link as proof too", async () => {
    const { token: reset } = await json<{ token: string }>(send("POST", "/internal/resets", { email: "fern@x.co" }));
    await send("POST", "/internal/resets/consume", { token: reset, passwordHash: HASH });
    expect((await json<Me>(call(`/internal/users/${writer.id}`))).emailVerified).toBe(true);
  });
});

describe("the morning email", () => {
  it("is sent only to those who asked, with the new pages from the diaries they subscribe to", async () => {
    await send("POST", `/internal/users/${reader.id}/subscriptions/${writer.handle}`);
    // Not asked for yet: nothing is due.
    expect((await json<{ due: Digest[] }>(call("/internal/digests"))).due).toEqual([]);
    await send("PATCH", `/internal/users/${reader.id}`, { emailDigest: true });
    await send("POST", `/internal/users/${writer.id}/entries`, { title: "Rain on the tin roof", body: "all night." });
    await send("POST", `/internal/users/${writer.id}/entries`, {
      title: "Only for me",
      body: "shh",
      visibility: "private",
    });
    const { asOf, due } = await json<{ asOf: string; due: Digest[] }>(call("/internal/digests"));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ userId: reader.id, email: "owl@x.co", name: "Owl" });
    expect(due[0]!.pages.map((p) => p.title)).toEqual(["Rain on the tin roof"]);
    expect(due[0]!.pages[0]).toMatchObject({ handle: writer.handle, author: "Fern", excerpt: "all night." });

    await send("POST", "/internal/digests/sent", { userIds: [reader.id], asOf });
    expect((await json<{ due: Digest[] }>(call("/internal/digests"))).due).toEqual([]);
  });

  it("stops with one click from the email", async () => {
    await send("POST", `/internal/users/${reader.id}/digest-off`);
    expect((await json<Me>(call(`/internal/users/${reader.id}`))).emailDigest).toBe(false);
  });
});
