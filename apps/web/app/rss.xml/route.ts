import { rssFeed } from "@/lib/rss";

export const revalidate = 300;

export async function GET() {
  return rssFeed({ title: "4me", about: "Night diaries on a 2006 desktop. The newest pages from everyone." });
}
