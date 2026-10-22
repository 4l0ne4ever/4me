import type { DiaryExport } from "@4me/shared";
import { API_URL, dayOf } from "./api";

type Page = DiaryExport["pages"][number];

/** A page's file name: its day and address (addresses often start with the day already). */
function stem(p: Page): string {
  const day = dayOf(p.writtenAt);
  return p.slug.startsWith(day) ? p.slug : `${day}-${p.slug}`;
}

/** Where each page's photos sit inside the zip: photos/2026-10-21-the-last-tram-1.jpg. */
export function photoPaths(diary: DiaryExport): Map<string, string> {
  const paths = new Map<string, string>();
  for (const p of diary.pages)
    p.photos.forEach((ph, i) => {
      if (!paths.has(ph.url)) paths.set(ph.url, `photos/${stem(p)}-${i + 1}.jpg`);
    });
  return paths;
}

const yaml = (v: string) => JSON.stringify(v);

/** One page as Markdown with front matter, so it opens in any notes app and imports into most blog tools. */
export function pageMarkdown(page: Page, photos: Map<string, string>): string {
  const img = (i: number) => {
    const ph = page.photos[i];
    const at = ph && photos.get(ph.url);
    return ph && at ? `![${ph.caption}](../${at})` : "";
  };
  const used = new Set<number>();
  const body = page.body
    .split(/\n{2,}/)
    .map((chunk) => {
      // A quote ("| line") is a Markdown blockquote, its lines kept.
      if (chunk.trim().startsWith("|"))
        return chunk
          .trim()
          .split("\n")
          .map((l) => `> ${l.replace(/^\|\s?/, "")}  `)
          .join("\n");
      const m = chunk.trim().match(/^\[photo (\d{1,2})\]$/i);
      if (!m) return chunk;
      const i = Number(m[1]) - 1;
      used.add(i);
      return img(i);
    })
    .join("\n\n");
  const rest = page.photos.map((_, i) => i).filter((i) => !used.has(i));

  const front = [
    "---",
    `title: ${yaml(page.title)}`,
    `date: ${page.writtenAt}`,
    page.mood && `mood: ${yaml(page.mood)}`,
    page.weather && `weather: ${yaml(page.weather)}`,
    page.song && `song: ${yaml(`${page.song.artist} – ${page.song.title}`)}`,
    `visibility: ${page.visibility}`,
    page.opensAt && `sealed_until: ${page.opensAt}`,
    `read: ${page.readCount}`,
    "---",
  ].filter(Boolean);

  const out = [front.join("\n"), `# ${page.title}`, body];
  if (rest.length) out.push(rest.map(img).join("\n\n"));
  if (page.notes.length) {
    const replies = (id: number) => page.notes.filter((n) => n.replyTo === id);
    const line = (n: Page["notes"][number], depth: number) =>
      `${"  ".repeat(depth)}- **${n.name}** (${dayOf(n.at)}): ${n.body.replace(/\n+/g, " ")}`;
    const lines: string[] = [];
    for (const n of page.notes.filter((x) => x.replyTo === null)) {
      lines.push(line(n, 0));
      for (const r of replies(n.id)) lines.push(line(r, 1));
    }
    out.push(`## Notes\n\n${lines.join("\n")}`);
  }
  return `${out.join("\n\n")}\n`;
}

const list = (title: string, items: Array<{ body: string; at: string; name?: string }>) =>
  `# ${title}\n\n${items
    .map((i) => `- ${dayOf(i.at)}${i.name ? ` · **${i.name}**` : ""}: ${i.body.replace(/\n+/g, " ")}`)
    .join("\n")}\n`;

/** Every text file in the zip, by path. */
export function diaryTexts(
  diary: DiaryExport,
  photos: Map<string, string>,
  missing: string[] = [],
): Map<string, string> {
  const files = new Map<string, string>();
  const names = new Set<string>();
  for (const p of diary.pages) {
    let name = `pages/${stem(p)}.md`;
    for (let n = 2; names.has(name); n++) name = `pages/${stem(p)}-${n}.md`;
    names.add(name);
    files.set(name, pageMarkdown(p, photos));
  }
  if (diary.blasts.length) files.set("blasts.md", list("Blasts", diary.blasts));
  if (diary.almost.length) files.set("almost-posted.md", list("Almost posted", diary.almost));
  if (diary.guestbook.length) files.set("guestbook.md", list("Guestbook", diary.guestbook));
  files.set("diary.json", `${JSON.stringify(diary, null, 2)}\n`);
  files.set(
    "README.txt",
    [
      `${diary.writer.name}'s diary on 4me (4me://${diary.writer.handle}), taken home on ${dayOf(diary.exportedAt)}.`,
      "",
      `pages/       ${diary.pages.length} pages, one Markdown file each, with what readers left on them`,
      "photos/      the photos on those pages",
      "blasts.md, almost-posted.md, guestbook.md",
      "diary.json   everything above in one file, for importing elsewhere",
      ...(missing.length ? ["", "These photos couldn't be fetched and aren't included:", ...missing] : []),
      "",
    ].join("\n"),
  );
  return files;
}

/** A photo's address as the browser can fetch it: uploads live on the API, the sample photos on this site. */
function fetchable(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return url.startsWith("/media/") ? `${API_URL}${url}` : url;
}

/** Fetches the photos, a few at a time, and packs everything into a zip the browser can save. */
export async function diaryZip(diary: DiaryExport, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { strToU8, zip } = await import("fflate");
  const photos = photoPaths(diary);
  const entries = [...photos.entries()];
  const bytes: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const missing: string[] = [];
  let done = 0;
  const queue = [...entries];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [url, path] = next;
      try {
        const res = await fetch(fetchable(url));
        if (!res.ok) throw new Error(String(res.status));
        // JPEGs are already compressed; storing them as they are is faster and no bigger.
        bytes[path] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
      } catch {
        missing.push(url);
      }
      onProgress?.(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  for (const [path, text] of diaryTexts(diary, photos, missing)) bytes[path] = strToU8(text);
  const root = `4me-${diary.writer.handle}-${dayOf(diary.exportedAt)}`;
  const tree = Object.fromEntries(Object.entries(bytes).map(([k, v]) => [`${root}/${k}`, v]));
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(tree, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as BlobPart], { type: "application/zip" });
}
