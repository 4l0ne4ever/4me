import { type Entry, type EntrySummary, excerpt } from "@4me/shared";
import { apiGet } from "@/lib/api";

export const revalidate = 300;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const list = (await apiGet<EntrySummary[]>("/entries?limit=20", 300)) ?? [];
  const full = await Promise.all(list.map((e) => apiGet<Entry>(`/entries/${e.slug}`, 300)));
  const items = full
    .filter((e): e is Entry => e !== null)
    .map((e) => {
      const song = e.song ? `<p>On repeat: ${esc(`${e.song.artist} – ${e.song.title}`)}</p>` : "";
      return `<item>
  <title>${esc(e.title)}</title>
  <link>${site}/n/${e.slug}</link>
  <guid isPermaLink="true">${site}/n/${e.slug}</guid>
  <pubDate>${new Date(e.writtenAt).toUTCString()}</pubDate>
  <description>${esc(`<p>${esc(excerpt(e.body, 400))}</p>${song}`)}</description>
</item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>4me</title>
  <link>${site}</link>
  <description>A night diary. One entry after dark, with the mood, the weather and the song.</description>
  <language>en</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
