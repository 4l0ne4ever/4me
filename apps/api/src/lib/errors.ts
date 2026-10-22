import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { errorEvents } from "../db/schema";
import type { DB } from "../db/types";
import type { AppEnv } from "../env";
import { sha256 } from "./guard";

export type ErrorReport = { source: "api" | "web" | "browser"; message: string; detail?: string; path?: string };

/** Database errors carry the query's parameters after the message; those can be emails or password hashes. */
export const scrub = (s: string) => s.split(/\nparams:|params:/)[0]!.trim();

/** Only the stack's "at …" lines: where in the code, never the message again (it may carry data). */
export function frames(err: unknown): string {
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  return stack
    .split("\n")
    .filter((l) => l.trim().startsWith("at "))
    .slice(0, 12)
    .join("\n");
}

/** A path without its query string or long ids, so the same error on two pages is one row. */
const shape = (path: string) =>
  path
    .split("?")[0]!
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .slice(0, 200);

/** Counts an error: a new kind gets a row, a known one its count and last time raised. Never throws. */
export async function recordError(db: DB, r: ErrorReport): Promise<void> {
  try {
    const message = scrub(r.message).slice(0, 500) || "unknown error";
    const path = shape(r.path ?? "");
    const fingerprint = (await sha256(`${r.source}|${message}|${path}`)).slice(0, 40);
    await db
      .insert(errorEvents)
      .values({ fingerprint, source: r.source, message, detail: (r.detail ?? "").slice(0, 4000), path })
      .onConflictDoUpdate({
        target: errorEvents.fingerprint,
        set: { count: sql`${errorEvents.count} + 1`, lastAt: new Date(), detail: (r.detail ?? "").slice(0, 4000) },
      });
  } catch (e) {
    console.error(`error log: ${e instanceof Error ? scrub(e.message) : "failed"}`);
  }
}

/** Records after the response on Workers, so a broken request doesn't wait on the log. */
export function recordLater(c: Context<AppEnv>, r: ErrorReport) {
  const work = recordError(c.get("db"), r);
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // no execution context outside Workers; it runs anyway
  }
}
