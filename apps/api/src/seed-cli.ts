// Seeds a real database (for example a fresh Neon branch): DATABASE_URL=... pnpm --filter @4me/api db:seed
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./db/schema";
import type { DB } from "./db/types";
import { seedIfEmpty } from "./seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const seeded = await seedIfEmpty(drizzle(neon(url), { schema }) as unknown as DB);
console.log(seeded ? "seeded sample nights" : "database already has entries; nothing changed");
