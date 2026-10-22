/** The diary is awake from 17:00 until 05:59 in the reader's own time. */
export function isAwakeHour(hour: number): boolean {
  return hour >= 17 || hour < 6;
}

/** "The lamps came on early" + 2026-10-19 -> "2026-10-19-the-lamps-came-on-early" */
export function slugify(title: string, date: Date): string {
  const words = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const day = date.toISOString().slice(0, 10);
  return words ? `${day}-${words}` : day;
}

export type Block =
  | { kind: "p"; parts: Inline[] }
  | { kind: "note"; text: string }
  | { kind: "photo"; index: number }
  /** Words from somewhere else (a lyric, something someone said), line by line, and who said them. */
  | { kind: "quote"; lines: Inline[][]; cite: string };

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "em"; text: string }
  /** Only ever an http(s) address. */
  | { kind: "link"; text: string; href: string };

/**
 * The diary's own tiny markup, parsed into blocks so the web app renders it without HTML injection.
 *   blank line   new paragraph
 *   ~~words~~    crossed out (the things almost said)
 *   _words_      italic
 *   > a line     a handwritten note in the margin colour
 *   | a line     a quote, its lines kept as they are; a last line "— someone" says whose words they are
 *   [words](https://…)   a link; a bare https://… address becomes a link too
 *   [photo 2]    the second attached photo, inline
 */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const photo = chunk.match(/^\[photo (\d{1,2})\]$/i);
    if (photo) {
      blocks.push({ kind: "photo", index: Number(photo[1]) - 1 });
      continue;
    }
    if (chunk.startsWith(">")) {
      blocks.push({ kind: "note", text: chunk.replace(/^>\s?/gm, "").replace(/\n/g, " ") });
      continue;
    }
    if (chunk.startsWith("|")) {
      const lines = chunk.split("\n").map((l) => l.replace(/^\|\s?/, "").trimEnd());
      const last = lines.at(-1) ?? "";
      const cite = /^(—|--|-)\s*\S/.test(last) ? last.replace(/^(—|--|-)\s*/, "") : "";
      if (cite) lines.pop();
      blocks.push({ kind: "quote", lines: lines.filter((l, i) => l || i > 0).map(parseInline), cite });
      continue;
    }
    blocks.push({ kind: "p", parts: parseInline(chunk.replace(/\n/g, " ")) });
  }
  return blocks;
}

// A named link, then a bare address (which never ends on the full stop or bracket after it), then the two styles.
const INLINE =
  /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)|(https?:\/\/[^\s<>()[\]]{1,500}[^\s<>()[\].,!?;:'"])|~~(.+?)~~|_(.+?)_/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const re = new RegExp(INLINE);
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) parts.push({ kind: "link", text: m[1], href: m[2] });
    else if (m[3] !== undefined) parts.push({ kind: "link", text: m[3].replace(/^https?:\/\//, ""), href: m[3] });
    else if (m[4] !== undefined) parts.push({ kind: "strike", text: m[4] });
    else if (m[5] !== undefined) parts.push({ kind: "em", text: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/**
 * Text as search compares it: lower-case, Vietnamese (and other) marks removed, spaces squeezed,
 * so "Mưa đầu mùa" and "mua dau mua" find each other.
 */
export function searchable(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** First paragraph as plain text, for feeds, previews and meta descriptions. */
export function excerpt(body: string, max = 180): string {
  const first = parseBody(body).find((b) => b.kind === "p");
  const text = first && first.kind === "p" ? first.parts.map((p) => p.text).join("") : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
