import { type Entry, excerpt } from "@4me/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeskPage } from "@/components/DeskPage";
import { apiGet } from "@/lib/api";
import { siteUrl } from "@/lib/auth";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;
// Built on first visit and cached like a static page (then refreshed every 30 seconds, or right after a change).
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ handle: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, slug } = await params;
  const entry = await apiGet<Entry>(`/entries/by/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, 30);
  if (!entry) return { title: "Not found" };
  const description = entry.sealedUntil ? "A sealed letter, not open yet." : excerpt(entry.body);
  return {
    title: `${entry.title} — ${entry.author.name}`,
    description,
    // One address for the page, whatever was added to it (?open=guest, tracking).
    alternates: {
      canonical: `/u/${entry.author.handle}/${entry.slug}`,
      types: { "application/rss+xml": `/u/${entry.author.handle}/rss.xml` },
    },
    // The picture is drawn by opengraph-image.tsx next to this page.
    openGraph: { type: "article", title: entry.title, description, publishedTime: entry.writtenAt },
    twitter: { card: "summary_large_image", title: entry.title, description },
  };
}

export default async function Night({ params }: Params) {
  const { handle, slug } = await params;
  const data = await loadDesktop({ handle, slug });
  if (!data?.entry) notFound();
  const { entry } = data;
  const url = `${siteUrl()}/u/${entry.author.handle}/${entry.slug}`;
  // What a search engine can tell from the page itself: a post in a diary, by its writer, on that night.
  const post = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: entry.title,
    datePublished: entry.writtenAt,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    author: { "@type": "Person", name: entry.author.name, url: `${siteUrl()}/u/${entry.author.handle}` },
    publisher: { "@type": "Organization", name: "4me", url: siteUrl() },
    ...(entry.sealedUntil ? {} : { description: excerpt(entry.body) }),
  };
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD; "<" is escaped so the text can't close the tag
        dangerouslySetInnerHTML={{ __html: JSON.stringify(post).replace(/</g, "\\u003c") }}
      />
      <DeskPage data={data} />
    </>
  );
}
