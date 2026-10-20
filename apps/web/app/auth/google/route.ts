import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { cookieOptions, googleEnabled, OAUTH_COOKIE, siteUrl } from "@/lib/auth";
import { randomToken, safeNext, sha256b64url } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** Starts "Sign in with Google": authorization code flow with PKCE and a one-time state, both kept in a short-lived cookie. */
export async function GET(req: NextRequest) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/welcome?error=google-off", req.url));
  const state = randomToken();
  const verifier = randomToken(48);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), cookieOptions(600));

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${siteUrl()}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: sha256b64url(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return NextResponse.redirect(url);
}
