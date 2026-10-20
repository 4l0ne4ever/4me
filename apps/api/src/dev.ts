// Local API without any cloud account: the same Hono app on Node, backed by PGlite (Postgres in WASM) on disk.
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "./app";
import * as schema from "./db/schema";
import type { DB } from "./db/types";
import type { Bindings } from "./env";
import { memoryStore, s3Store } from "./lib/media";
import { seedIfEmpty } from "./seed";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env, defaults below are fine for local work
}

const db = drizzle(new PGlite(process.env.PGLITE_DIR ?? ".pglite"), { schema }) as unknown as DB;
await migrate(db as never, { migrationsFolder: "./drizzle" });
if (await seedIfEmpty(db)) console.log("seeded sample nights");

const env: Bindings = {
  DATABASE_URL: "pglite",
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "dev-admin-token",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  IP_SALT: "dev",
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET,
  LASTFM_API_KEY: process.env.LASTFM_API_KEY,
  LASTFM_USER: process.env.LASTFM_USER,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
};

// Photos stay in memory unless a bucket is configured in .env; they are gone when the dev server restarts.
const media = s3Store(env) ?? memoryStore();
const app = createApp(
  () => db,
  () => media,
);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (req) => app.fetch(req, env), port });
console.log(`4me api on http://localhost:${port}`);
