import { type Entry, excerpt } from "@4me/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeskPage } from "@/components/DeskPage";
import { apiGet } from "@/lib/api";
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
    alternates: { types: { "application/rss+xml": `/u/${entry.author.handle}/rss.xml` } },
    // The picture is drawn by opengraph-image.tsx next to this page.
    openGraph: { type: "article", title: entry.title, description, publishedTime: entry.writtenAt },
    twitter: { card: "summary_large_image", title: entry.title, description },
  };
}

export default async function Night({ params }: Params) {
  const { handle, slug } = await params;
  const data = await loadDesktop({ handle, slug });
  if (!data?.entry) notFound();
  return <DeskPage data={data} />;
}
