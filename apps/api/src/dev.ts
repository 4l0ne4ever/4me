// Local API without any cloud account: the same Hono app on Node, backed by PGlite (Postgres in WASM) on disk.

import { readTicket, TABLE_CODE } from "@4me/shared";
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
import { MemoryTables } from "./live/table";
import { vetTopics } from "./live/vet";
import { seatOf } from "./routes/tables";
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
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
};

// Photos stay in memory unless a bucket is configured in .env; they are gone when the dev server restarts.
const media = s3Store(env) ?? memoryStore();
// Live updates in this process; production uses the Hub Durable Object with the same rules.
const hub = new MemoryHub();
// Werewolf tables in this process too; production keeps each in its own Durable Object.
const tables = new MemoryTables();
const app = createApp(
  () => db,
  () => media,
  () => hub,
  () => tables,
);
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: (req) => app.fetch(req, env), port });

// Sealed letters: the Worker's cron does this every ten minutes in production.
setInterval(() => {
  void app.request(
    "/internal/letters/open",
    { method: "POST", headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` } },
    env,
  );
}, 60_000);

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", async (req, socket, head) => {
  // A browser that closes mid-handshake resets the socket; that must not take the dev server down.
  socket.on("error", () => socket.destroy());
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const origin = req.headers.origin ?? "";
  const table = url.pathname.match(/^\/tables\/([a-z0-9]{6})\/ws$/)?.[1];
  if (table && TABLE_CODE.test(table) && env.WEB_ORIGIN.split(",").includes(origin)) {
    const uid = await readTicket("live", url.searchParams.get("ticket") ?? "", env.ADMIN_TOKEN);
    const seat = uid ? await seatOf({ get: () => db } as never, uid) : null;
    if (!seat) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const conn = { uid: seat.id, send: (d: string) => ws.send(d), close: (c: number, r: string) => ws.close(c, r) };
      const queue: string[] = [];
      let at: Awaited<ReturnType<typeof tables.attach>> | undefined;
      ws.on("message", (m) => {
        const text = m.toString();
        if (text === "ping") return ws.send("pong");
        if (at) void at.message(text);
        else if (at === undefined) queue.push(text);
      });
      ws.on("close", () => void at?.close());
      at = await tables.attach(table, seat, conn);
      for (const q of queue.splice(0)) void at?.message(q);
    });
    return;
  }
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
    ws.on("error", () => hub.remove(ws));
  });
});
console.log(`4me api on http://localhost:${port}`);
