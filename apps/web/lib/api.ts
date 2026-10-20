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

export function hhmm(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
