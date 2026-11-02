import { createHmac, timingSafeEqual } from "node:crypto";

// The addresses of uploaded photos. A photo on a page anyone may read has a plain address (/media/u/2/….jpg), and
// the API checks, each time it is asked for it, that some page anyone may read still shows it. Everything else (a
// private page, a draft, a sealed letter its writer is looking at, a photo just uploaded) is only ever given to its
// writer, with a signed address: ?e=<page>&x=<expiry>&s=<signature>. The signature covers the page's state
// (visibility, moderation, sealed or open), so making the page private, sealing it, hiding it or deleting it ends
// every address handed out before, and none lasts more than half a day anyway.

export type Links = { origin: string; secret: string };

/** What a page's photos are bound to. */
export type PageState = { visibility: string; status: string; sealed: boolean };

/** A photo just uploaded and not on any page yet. */
export const UNPLACED = 0;
const UNPLACED_STATE = "unplaced";

/** Signed addresses expire at the end of the next six-hour window, so they stay the same (and cacheable) for hours. */
const WINDOW_MS = 6 * 3600_000;

const stateOf = (s: PageState | null) =>
  s ? `${s.visibility}.${s.status}.${s.sealed ? "sealed" : "open"}` : UNPLACED_STATE;
const sign = (secret: string, key: string, entryId: number, exp: number, state: string) =>
  createHmac("sha256", secret).update(`media.${key}.${entryId}.${exp}.${state}`).digest("base64url");

/** Anyone may read the page as it stands; its photos need no signature. */
export const isPublicState = (s: PageState) => s.visibility === "public" && s.status === "visible" && !s.sealed;

/** "/media/u/2/x.jpg" as the browser asks for it: plain for a page anyone may read, signed for its writer otherwise. */
export function photoLink(
  links: Links,
  path: string,
  entryId: number,
  state: PageState | null,
  now = Date.now(),
): string {
  if (!path.startsWith("/media/")) return path;
  const url = `${links.origin}${path}`;
  if (state && isPublicState(state)) return url;
  const exp = (Math.floor(now / WINDOW_MS) + 2) * WINDOW_MS;
  const sig = sign(links.secret, path.slice("/media/".length), entryId, exp, stateOf(state));
  return `${url}?e=${entryId}&x=${exp}&s=${sig}`;
}

/** The parts of a signed address, or null when it isn't one. */
export function readSigned(q: { e?: string; x?: string; s?: string }) {
  if (!q.e || !q.x || !q.s) return null;
  if (!/^\d{1,10}$/.test(q.e) || !/^\d{1,16}$/.test(q.x) || !/^[A-Za-z0-9_-]{43}$/.test(q.s)) return null;
  return { entryId: Number(q.e), exp: Number(q.x), sig: q.s };
}

/** True when the signature was made for this photo, on this page, in the state the page is in now, and is current. */
export function checkSigned(
  secret: string,
  key: string,
  signed: { entryId: number; exp: number; sig: string },
  state: PageState | null,
  now = Date.now(),
): boolean {
  if (!secret || signed.exp < now || signed.exp > now + 2 * WINDOW_MS) return false;
  const expected = Buffer.from(sign(secret, key, signed.entryId, signed.exp, stateOf(state)));
  const given = Buffer.from(signed.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type EdgeCache = {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
  delete(req: Request): Promise<boolean>;
};
/** The Worker's cache in this data centre; none in development and tests. */
export const edgeCache = () => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

/** A photo's place in the edge cache: its plain address, one per photo, whatever address it was asked for by. */
export const cachedPhoto = (origin: string, key: string) => new Request(`${origin}/media/${key}`);

/** Forgets deleted photos at the edge (this data centre's copy; elsewhere the access check already refuses them). */
export async function forgetCached(origin: string, keys: string[]) {
  const cache = edgeCache();
  if (cache) await Promise.allSettled(keys.map((k) => cache.delete(cachedPhoto(origin, k))));
}
