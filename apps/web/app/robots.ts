import type { MetadataRoute } from "next";

/** Diaries are for reading; sign-in, accounts and moderation are not for search engines. */
export default function robots(): MetadataRoute.Robots {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/me", "/auth/", "/welcome", "/reset", "/verify", "/unsubscribe", "/api/"],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
