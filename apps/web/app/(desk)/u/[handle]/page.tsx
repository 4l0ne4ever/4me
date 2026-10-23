import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeskPage } from "@/components/DeskPage";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;
// Built on first visit and cached like a static page (then refreshed every 30 seconds, or right after a change).
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const data = await loadDesktop({ handle });
  if (!data?.owner) return { title: "Not found" };
  const { owner } = data;
  return {
    title: `${owner.name}'s desktop`,
    description: owner.bio || `${owner.name}'s night diary on 4me.`,
    alternates: { canonical: `/u/${owner.handle}`, types: { "application/rss+xml": `/u/${owner.handle}/rss.xml` } },
    openGraph: { type: "profile", title: owner.name },
    twitter: { card: "summary_large_image", title: `${owner.name}'s diary` },
  };
}

/** One member's desktop: their newest page, their guestbook, their blasts and bin. */
export default async function MemberDesktop({ params }: Params) {
  const { handle } = await params;
  const data = await loadDesktop({ handle });
  if (!data) notFound();
  return <DeskPage data={data} />;
}
