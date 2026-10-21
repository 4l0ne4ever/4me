// Local API without any cloud account: the same Hono app on Node, backed by PGlite (Postgres in WASM) on disk.
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { WebSocketServer } from "ws";
import { createApp } from "./app";
import * as schema from "./db/schema";
import type { DB } from "./db/types";
import type { Bindings } from "./env";
import { memoryStore, s3Store } from "./lib/media";
import { MemoryHub } from "./live/memory";
import { vetTopics } from "./live/vet";
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
// Live updates in this process; production uses the Hub Durable Object with the same rules.
const hub = new MemoryHub();
const app = createApp(
  () => db,
  () => media,
  () => hub,
);
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: (req) => app.fetch(req, env), port });

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const origin = req.headers.origin ?? "";
  const topics =
    url.pathname === "/live" && env.WEB_ORIGIN.split(",").includes(origin)
      ? await vetTopics(url, env.ADMIN_TOKEN)
      : null;
  if (!topics) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    hub.add(ws, topics);
    ws.on("message", (m) => {
      if (m.toString() === "ping") ws.send("pong");
    });
    ws.on("close", () => hub.remove(ws));
  });
});
console.log(`4me api on http://localhost:${port}`);
