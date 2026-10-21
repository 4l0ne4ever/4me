import type { Profile } from "@4me/shared";
import { apiGet } from "@/lib/api";
import { rssFeed } from "@/lib/rss";

export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const owner = await apiGet<Profile>(`/profiles/${encodeURIComponent(handle)}`, 300);
  if (!owner) return new Response("not found", { status: 404 });
  return rssFeed({
    handle: owner.handle,
    title: `${owner.name} · 4me`,
    about: owner.bio || `${owner.name}'s night diary.`,
  });
}
