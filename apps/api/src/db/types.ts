import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// Neon over HTTP in production, PGlite in tests and local dev: both are Postgres databases with this schema.
// biome-ignore lint/suspicious/noExplicitAny: the two drivers use different query-result types
export type DB = PgDatabase<any, typeof schema>;
