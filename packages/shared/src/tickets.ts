// Short-lived tickets the web server signs with the server token and the API checks, both with this file, so the
// two sides can't drift apart. One kind lets a member send photos straight to the API ("upload"); another lets
// their browser listen for their own notifications ("live").
// Format: v1.<purpose>.<user id>.<expiry ms>.<HMAC-SHA256 of "<purpose>.<user id>.<expiry ms>", base64url>

export type TicketPurpose = "upload" | "live";
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

export async function signTicket(
  purpose: TicketPurpose,
  uid: number,
  secret: string,
  now = Date.now(),
  ttlMs = 10 * 60_000,
) {
  const exp = now + Math.min(ttlMs, MAX_TTL_MS);
  return `v1.${purpose}.${uid}.${exp}.${await hmac(secret, `${purpose}.${uid}.${exp}`)}`;
}

/** The member id the ticket was signed for, or null when it is forged, expired, malformed or for another purpose. */
export async function readTicket(
  purpose: TicketPurpose,
  ticket: string,
  secret: string,
  now = Date.now(),
): Promise<number | null> {
  const [v, kind, uid, exp, sig, extra] = ticket.split(".");
  if (v !== "v1" || kind !== purpose || !uid || !exp || !sig || extra !== undefined || !secret) return null;
  if (!/^\d{1,10}$/.test(uid) || !/^\d{1,16}$/.test(exp)) return null;
  if (Number(exp) < now || Number(exp) > now + MAX_TTL_MS) return null;
  const expected = await hmac(secret, `${purpose}.${uid}.${exp}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? Number(uid) : null;
}
