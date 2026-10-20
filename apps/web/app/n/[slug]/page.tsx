import { type Entry, excerpt } from "@4me/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Desktop } from "@/components/Desktop";
import { apiGet } from "@/lib/api";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const entry = await apiGet<Entry>(`/entries/${encodeURIComponent(slug)}`, 30);
  if (!entry) return { title: "Not found" };
  const description = excerpt(entry.body);
  const image = entry.photos[0]?.url ?? "/photos/pic-229.jpg";
  return {
    title: entry.title,
    description,
    openGraph: { type: "article", title: entry.title, description, images: [image], publishedTime: entry.writtenAt },
    twitter: { card: "summary_large_image", title: entry.title, description, images: [image] },
  };
}

export default async function Night({ params }: Params) {
  const { slug } = await params;
  const data = await loadDesktop(slug);
  if (!data.entry) notFound();
  return <Desktop data={data} />;
}
