// Upload tickets let one member send photos straight from the browser to the API for a few minutes. The web
// server signs them with the server token and the API checks them, both with this file, so the two sides can't
// drift apart. Format: v1.<user id>.<expiry ms>.<HMAC-SHA256 of "upload.<user id>.<expiry ms>", base64url>

const MAX_TTL_MS = 15 * 60_000;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return btoa(String.fromCharCode(...sig))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function signUploadTicket(uid: number, secret: string, now = Date.now(), ttlMs = 10 * 60_000) {
  const exp = now + Math.min(ttlMs, MAX_TTL_MS);
  return `v1.${uid}.${exp}.${await hmac(secret, `upload.${uid}.${exp}`)}`;
}

/** The member id the ticket was signed for, or null when it is forged, expired or malformed. */
export async function readUploadTicket(ticket: string, secret: string, now = Date.now()): Promise<number | null> {
  const [v, uid, exp, sig, extra] = ticket.split(".");
  if (v !== "v1" || !uid || !exp || !sig || extra !== undefined || !secret) return null;
  if (!/^\d{1,10}$/.test(uid) || !/^\d{1,16}$/.test(exp)) return null;
  if (Number(exp) < now || Number(exp) > now + MAX_TTL_MS) return null;
  const expected = await hmac(secret, `upload.${uid}.${exp}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? Number(uid) : null;
}
