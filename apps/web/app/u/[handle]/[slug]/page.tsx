import { type Entry, excerpt } from "@4me/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Desktop } from "@/components/Desktop";
import { apiGet } from "@/lib/api";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;

type Params = { params: Promise<{ handle: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, slug } = await params;
  const entry = await apiGet<Entry>(`/entries/by/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, 30);
  if (!entry) return { title: "Not found" };
  const description = excerpt(entry.body);
  const image = entry.photos[0]?.url ?? entry.author.avatar;
  return {
    title: `${entry.title} — ${entry.author.name}`,
    description,
    alternates: { types: { "application/rss+xml": `/u/${entry.author.handle}/rss.xml` } },
    openGraph: { type: "article", title: entry.title, description, images: [image], publishedTime: entry.writtenAt },
    twitter: { card: "summary_large_image", title: entry.title, description, images: [image] },
  };
}

export default async function Night({ params }: Params) {
  const { handle, slug } = await params;
  const data = await loadDesktop({ handle, slug });
  if (!data?.entry) notFound();
  return <Desktop data={data} />;
}
