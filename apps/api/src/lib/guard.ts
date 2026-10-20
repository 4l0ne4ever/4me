import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { rateHits } from "../db/schema";
import type { AppEnv } from "../env";

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(c: Context<AppEnv>): string {
  const forwarded = c.get("clientIp");
  if (forwarded) return forwarded.slice(0, 64);
  return (c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local").slice(
    0,
    64,
  );
}

/** A stable, salted fingerprint of the visitor. Raw IPs are never stored. */
export async function ipHash(c: Context<AppEnv>): Promise<string> {
  return (await sha256(`${c.env.IP_SALT ?? "4me"}:${clientIp(c)}`)).slice(0, 32);
}

/**
 * Fixed-window rate limit kept in Postgres, so it holds across Worker isolates.
 * Returns true when the call is allowed.
 */
export async function allow(c: Context<AppEnv>, bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  return allowKey(c, `${bucket}:${await ipHash(c)}`, max, windowSeconds);
}

/** The same limit on any key: a member id, or a hashed email address for sign-in attempts. */
export async function allowKey(c: Context<AppEnv>, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const db = c.get("db");
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const [row] = await db
    .insert(rateHits)
    .values({ key, window, count: 1 })
    .onConflictDoUpdate({ target: [rateHits.key, rateHits.window], set: { count: sql`${rateHits.count} + 1` } })
    .returning({ count: rateHits.count });
  return (row?.count ?? 1) <= max;
}

/** Cloudflare Turnstile. When no secret is configured (local dev, tests) every write passes. */
export async function humanCheck(c: Context<AppEnv>, token: string | undefined): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", clientIp(c));
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Links are the usual sign of spam: hold those notes for the author to approve. */
export function looksLikeSpam(text: string): boolean {
  return /https?:\/\/|www\.|\.(ru|xyz|top)\b/i.test(text);
}

/** Names nobody may take, so no one can pass as the author. */
export function isReservedName(name: string): boolean {
  const k = name
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
  return ["4me", "4meauthor", "author", "admin", "administrator", "ink"].includes(k);
}

export async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
