import "server-only";
import type { Me } from "@4me/shared";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { API_URL } from "./api";
import { readSession, signSession } from "./crypto";

const SECURE = process.env.NODE_ENV === "production";
/** In production the cookie carries the __Host- prefix: HTTPS only, this exact host, path "/". */
export const SESSION_COOKIE = SECURE ? "__Host-4me_session" : "4me_session";
export const OAUTH_COOKIE = SECURE ? "__Host-4me_oauth" : "4me_oauth";
const MAX_AGE = 60 * 60 * 24 * 30;

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 random characters");
  return s;
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** The reader's address as the platform saw it, passed to the API for rate limits. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
}

type ApiFail = { error: string; field?: string };
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

/** Server-to-server call to the API's account routes. The token stays on this server. */
export async function internalApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const ip = await clientIp();
  const res = await fetch(`${API_URL}/internal${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${process.env.ADMIN_TOKEN ?? ""}`,
      ...(ip ? { "x-client-ip": ip } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiFail;
  if (!res.ok) throw new ApiError(data.error ?? "something went wrong", res.status, data.field);
  return data;
}

export async function startSession(uid: number, sv: number) {
  const token = signSession({ uid, sv, exp: Date.now() + MAX_AGE * 1000 }, sessionSecret());
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(MAX_AGE));
}

export async function endSession() {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
}

export type MeWithVersion = Me & { sessionVersion: number };

/**
 * The signed-in reader, or null. The cookie must be validly signed, unexpired, and carry the account's
 * current session version, so a password change or "sign out everywhere" ends every old session.
 */
export const getMe = cache(async (): Promise<MeWithVersion | null> => {
  const s = readSession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
  if (!s) return null;
  try {
    const me = await internalApi<MeWithVersion>(`/users/${s.uid}`);
    return me.sessionVersion === s.sv ? me : null;
  } catch {
    return null;
  }
});

export function publicMe(me: MeWithVersion): Me {
  const { sessionVersion: _drop, ...rest } = me;
  return rest;
}

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const mailEnabled = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export function siteUrl(): string {
  const url = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (SECURE && !url.startsWith("https://")) throw new Error("NEXT_PUBLIC_SITE_URL must be https:// in production");
  return url;
}
