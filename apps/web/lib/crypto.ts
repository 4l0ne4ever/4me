// Password hashing and session tokens. Plain Node crypto, no framework imports, so it is easy to test.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const N = 32768; // 2^15: about 32 MB and tens of milliseconds per hash, on the server only
const R = 8;
const P = 1;
const KEYLEN = 32;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** "scrypt$N$r$p$salt$hash", base64url parts, a fresh 16-byte salt every time. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Compared against when an address has no account, so a wrong email takes as long as a wrong password. */
export const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function sameString(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export type Session = { uid: number; sv: number; exp: number };

/** "v1.uid.sessionVersion.expiry.signature", signed with HMAC-SHA256. */
export function signSession(s: Session, secret: string): string {
  const body = `v1.${s.uid}.${s.sv}.${s.exp}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readSession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const body = parts.slice(0, 4).join(".");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  if (!sameString(sig, parts[4] ?? "")) return null;
  const [uid, sv, exp] = parts.slice(1, 4).map(Number);
  if (!uid || !sv || !exp || exp < now) return null;
  return { uid, sv, exp };
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256b64url = (s: string) => createHash("sha256").update(s).digest("base64url");

/** Only same-site paths may be used after signing in: "/n/x" is fine, "//evil.com" and "https://…" are not. */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("\n")) return "/";
  return next.slice(0, 300);
}

/** The token in a morning email's unsubscribe link: it turns off that member's emails and nobody else's. */
export const unsubscribeToken = (uid: number, secret: string) =>
  createHmac("sha256", secret).update(`digest-off.v1.${uid}`).digest("base64url").slice(0, 32);
export const checkUnsubscribe = (uid: number, token: string, secret: string) =>
  Number.isInteger(uid) && uid > 0 && sameString(unsubscribeToken(uid, secret), token);
