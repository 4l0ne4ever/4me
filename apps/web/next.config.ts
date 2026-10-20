import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Both addresses are baked into the build, so a typo fails here with its name instead of "Invalid URL" later.
// They are public (they end up in the browser bundle), so the bad value is printed to make it easy to spot.
for (const name of ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_API_URL"]) {
  const value = process.env[name];
  if (value && !(URL.canParse(value) && /^https?:\/\//.test(value))) {
    throw new Error(
      `${name} must be a full address such as https://4me-night.vercel.app, got ${JSON.stringify(value)}`,
    );
  }
}

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").origin;
const https = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

// Scripts keep 'unsafe-inline' because Next.js inlines its bootstrap; React escapes everything it renders,
// and every other source is pinned to the hosts this site really uses.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  // Photos are served by the API (http on localhost while developing), song covers and other pictures over https.
  `img-src 'self' data: blob: https: ${apiOrigin}`,
  "font-src 'self'",
  // The 30-second song previews come from Apple's servers.
  "media-src 'self' blob: https://*.apple.com https://*.mzstatic.com",
  `connect-src 'self' ${apiOrigin} https://challenges.cloudflare.com${dev ? " ws:" : ""}`,
  "frame-src https://open.spotify.com https://www.youtube-nocookie.com https://w.soundcloud.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Any stray http:// load is fetched over https instead, once the site itself is served over https.
  ...(https ? ["upgrade-insecure-requests"] : []),
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@4me/shared"],
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HTTPS only, for two years, subdomains included (ignored by browsers on plain-http localhost).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default config;
