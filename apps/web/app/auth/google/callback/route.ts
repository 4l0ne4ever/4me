import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { cookieOptions, internalApi, type MeWithVersion, OAUTH_COOKIE, siteUrl, startSession } from "@/lib/auth";
import { safeNext, sameString } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type IdToken = {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

function fail(req: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/welcome?error=${reason}`, req.url));
}

/** Google sends the reader back here with a code; we check the state, swap the code for an ID token, and sign them in. */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.set(OAUTH_COOKIE, "", cookieOptions(0));
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(req, "google-cancelled");

  let saved: { state: string; verifier: string; next: string };
  try {
    saved = JSON.parse(raw ?? "");
  } catch {
    return fail(req, "google-expired");
  }
  const code = params.get("code");
  if (!code || !saved.state || !sameString(saved.state, params.get("state") ?? "")) return fail(req, "google-expired");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${siteUrl()}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return fail(req, "google-failed");
  const { id_token } = (await res.json()) as { id_token?: string };

  // The token came straight from Google's token endpoint over TLS, so its claims can be read directly;
  // issuer, audience and expiry are still checked.
  let claims: IdToken;
  try {
    claims = JSON.parse(Buffer.from((id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return fail(req, "google-failed");
  }
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (
    !issuerOk ||
    claims.aud !== process.env.GOOGLE_CLIENT_ID ||
    !claims.sub ||
    (claims.exp ?? 0) * 1000 < Date.now()
  ) {
    return fail(req, "google-failed");
  }

  let me: MeWithVersion;
  try {
    me = await internalApi<MeWithVersion>("/oauth/google", {
      method: "POST",
      body: {
        sub: claims.sub,
        email: claims.email ?? null,
        emailVerified: claims.email_verified === true,
        name: claims.name ?? "",
      },
    });
  } catch {
    return fail(req, "google-failed");
  }
  await startSession(me.id, me.sessionVersion);
  return NextResponse.redirect(new URL(safeNext(saved.next), siteUrl()));
}
