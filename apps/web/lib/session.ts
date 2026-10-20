import "server-only";
import { cookies } from "next/headers";

const COOKIE = "4me_author";
const MAX_AGE = 60 * 60 * 24 * 14;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SESSION_SECRET must be set (16+ characters)");
  return s;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(sig).toString("base64url");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(given: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  return same(await hmac(`pw:${given}`), await hmac(`pw:${expected}`));
}

export async function startSession() {
  const expires = Date.now() + MAX_AGE * 1000;
  const value = `${expires}.${await hmac(`session:${expires}`)}`;
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function isAuthor(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [expires, sig] = raw.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return same(sig, await hmac(`session:${expires}`));
}
