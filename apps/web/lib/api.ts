export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

/** Server-side read with Next's data cache. Returns null when the API is down, so pages still render. */
export async function apiGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate, tags: ["api"] } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** Browser-side write straight to the API (CORS allows the site's origin). */
export async function apiSend<T>(path: string, body?: unknown, method = "POST"): Promise<Result<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "something went wrong", status: res.status };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "can't reach the diary right now", status: 0 };
  }
}

/**
 * Pages say when they were written in the diary's own time, Vietnam's, the same on the server and in every browser
 * (so the page the server sends and the one the browser draws agree, and "21:04" means the night it was written).
 */
export const SITE_TZ = "Asia/Ho_Chi_Minh";

const hm = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: SITE_TZ,
});
const long = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: SITE_TZ });
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: SITE_TZ });
const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: SITE_TZ });

export const hhmm = (iso: string | Date) => hm.format(typeof iso === "string" ? new Date(iso) : iso);
export const longDate = (iso: string) => long.format(new Date(iso));
export const shortDate = (iso: string) => short.format(new Date(iso));
/** "2026-10-21" in the diary's time, for "is this tonight?" */
export const dayOf = (iso: string | Date) => day.format(typeof iso === "string" ? new Date(iso) : iso);

/** A time for a line in a guestbook or chat: just the hour today, with the day before that ("20 Oct, 16:34"). */
export const stamp = (iso: string) =>
  dayOf(iso) === dayOf(new Date()) ? hhmm(iso) : `${shortDate(iso)}, ${hhmm(iso)}`;

/** The taskbar clock is the reader's own. */
export function clockTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
