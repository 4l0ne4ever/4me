import { type Entry, type EntrySummary, excerpt } from "@4me/shared";
import { apiGet } from "./api";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An RSS feed of the newest public pages: everyone's, or one member's. */
export async function rssFeed({ handle, title, about }: { handle?: string; title: string; about: string }) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const list =
    (await apiGet<EntrySummary[]>(
      handle ? `/entries?author=${encodeURIComponent(handle)}&limit=20` : "/entries?limit=20",
      300,
    )) ?? [];
  const full = await Promise.all(
    list.map((e) =>
      apiGet<Entry>(`/entries/by/${encodeURIComponent(e.author.handle)}/${encodeURIComponent(e.slug)}`, 300),
    ),
  );
  const items = full
    .filter((e): e is Entry => e !== null)
    .map((e) => {
      const link = `${site}/u/${e.author.handle}/${e.slug}`;
      const song = e.song ? `<p>On repeat: ${esc(`${e.song.artist} – ${e.song.title}`)}</p>` : "";
      return `<item>
  <title>${esc(e.title)}</title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <author>${esc(e.author.name)}</author>
  <pubDate>${new Date(e.writtenAt).toUTCString()}</pubDate>
  <description>${esc(`<p>${esc(excerpt(e.body, 400))}</p>${song}`)}</description>
</item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(title)}</title>
  <link>${site}${handle ? `/u/${handle}` : ""}</link>
  <description>${esc(about)}</description>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
