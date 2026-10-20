import "server-only";
import { API_URL } from "./api";

/** Author-only calls. Runs on the web server; the token never reaches a browser. */
export async function adminApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/admin${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${process.env.ADMIN_TOKEN ?? ""}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `API ${res.status}`);
  return data;
}
