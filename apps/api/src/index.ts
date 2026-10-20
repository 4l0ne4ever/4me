import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createApp } from "./app";
import * as schema from "./db/schema";
import type { DB } from "./db/types";

// One HTTP client per isolate; Neon's driver is stateless, so reusing it is safe and saves setup per request.
let cached: { url: string; db: DB } | null = null;

export default createApp((env) => {
  if (!cached || cached.url !== env.DATABASE_URL) {
    cached = { url: env.DATABASE_URL, db: drizzle(neon(env.DATABASE_URL), { schema }) as unknown as DB };
  }
  return cached.db;
});
