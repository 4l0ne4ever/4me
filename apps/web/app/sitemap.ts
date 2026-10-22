import type { MetadataRoute } from "next";
import { apiGet } from "@/lib/api";

export const revalidate = 3600;

type Page = { handle: string; slug: string; at: string };

/** Every public page and every desktop that has one, for search engines. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const pages = (await apiGet<Page[]>("/entries/sitemap", 3600)) ?? [];
  // A desktop changes when its newest page does; pages come newest first, so the first one seen is the newest.
  const desks = new Map<string, string>();
  for (const p of pages) if (!desks.has(p.handle)) desks.set(p.handle, p.at);
  return [
    { url: `${site}/`, lastModified: pages[0]?.at, changeFrequency: "hourly", priority: 1 },
    ...[...desks].map(([handle, at]) => ({ url: `${site}/u/${handle}`, lastModified: at, priority: 0.7 })),
    ...pages.map((p) => ({ url: `${site}/u/${p.handle}/${p.slug}`, lastModified: p.at, priority: 0.6 })),
    { url: `${site}/privacy`, priority: 0.2 },
  ];
}
