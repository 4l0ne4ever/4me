import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createApp } from "./app";
import * as schema from "./db/schema";
import type { DB } from "./db/types";
import type { Bindings } from "./env";
import { type MediaStore, s3Store } from "./lib/media";
import { hubLive } from "./live/hub";

export { Hub } from "./live/hub";

// One HTTP client per isolate; Neon's driver is stateless, so reusing it is safe and saves setup per request.
let cached: { url: string; db: DB } | null = null;
let media: { endpoint: string | undefined; store: MediaStore | null } | null = null;

const app = createApp(
  (env) => {
    if (!cached || cached.url !== env.DATABASE_URL) {
      cached = { url: env.DATABASE_URL, db: drizzle(neon(env.DATABASE_URL), { schema }) as unknown as DB };
    }
    return cached.db;
  },
  (env) => {
    if (!media || media.endpoint !== env.S3_ENDPOINT) media = { endpoint: env.S3_ENDPOINT, store: s3Store(env) };
    return media.store;
  },
  (env) => (env.HUB ? hubLive(env.HUB) : null),
);

export default {
  fetch: app.fetch,
  /** Every ten minutes: sealed letters whose day has come are announced to their readers. */
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    const req = new Request("https://cron.4me/internal/letters/open", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` },
    });
    ctx.waitUntil(Promise.resolve(app.fetch(req, env, ctx)));
  },
} satisfies ExportedHandler<Bindings>;
