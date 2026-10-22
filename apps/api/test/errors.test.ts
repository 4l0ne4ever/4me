import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import type { Bindings } from "../src/env";
import { recordError, scrub } from "../src/lib/errors";

const env: Bindings = { DATABASE_URL: "pglite", ADMIN_TOKEN: "server-token", WEB_ORIGIN: "https://4me.example" };
let app: ReturnType<typeof createApp>;
let db: DB;
const call = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
  headers.set("cf-connecting-ip", "198.51.100.9");
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers }, env);
};
type Row = { source: string; message: string; path: string; count: number };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  app = createApp(() => db);
});

describe("the error log", () => {
  it("never keeps a query's parameters", () => {
    expect(scrub("Failed query: select * from users where email = $1\nparams: owl@x.co")).toBe(
      "Failed query: select * from users where email = $1",
    );
  });

  it("counts the same error on different pages as one, by its shape", async () => {
    await recordError(db, { source: "api", message: "TypeError: x is undefined", path: "GET /entries/12/notes" });
    await recordError(db, { source: "api", message: "TypeError: x is undefined", path: "GET /entries/40/notes?x=1" });
    const rows = (await (await call("/admin/errors")).json()) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "api", path: "GET /entries/:id/notes", count: 2 });
  });

  it("takes reports from the web server, and lists the last day's for the morning summary", async () => {
    const res = await call("/internal/errors", {
      method: "POST",
      body: JSON.stringify({ source: "web", message: "render failed", path: "/u/lan" }),
    });
    expect(res.status).toBe(200);
    const recent = (await (await call("/internal/errors/recent?hours=24")).json()) as Row[];
    expect(recent.map((r) => r.message).sort()).toEqual(["TypeError: x is undefined", "render failed"]);
  });

  it("is only for the server and the moderator", async () => {
    const res = await app.request("/admin/errors", {}, env);
    expect(res.status).toBe(401);
  });

  it("starts again once the moderator has seen to it", async () => {
    await call("/admin/errors", { method: "DELETE" });
    expect(await (await call("/admin/errors")).json()).toEqual([]);
  });
});
