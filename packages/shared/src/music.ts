import { z } from "zod";
import type { SongResult, SongSticker } from "./schemas";

// Songs come from the iTunes Search API: free, no key, every song has a 30-second preview. The reader's browser asks
// it directly (Apple allows that from any site, and blocks many cloud servers), so the servers never call Apple;
// they only check that what was picked points at Apple's own hosts.

/** Only Apple's own hosts are stored, so a page can never be made to load audio or images from anywhere else. */
export function appleUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const ok = u.protocol === "https:" && (u.hostname.endsWith(".apple.com") || u.hostname.endsWith(".mzstatic.com"));
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

export const itunesSearchUrl = (term: string, country = "VN") =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term.slice(0, 80))}&media=music&entity=song&limit=15&country=${country}`;

type ITunesTrack = {
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
};

export function toSongResult(t: ITunesTrack): SongResult | null {
  if (t.kind !== "song" || !t.trackId || !t.trackName) return null;
  return {
    id: t.trackId,
    title: t.trackName.slice(0, 120),
    artist: (t.artistName ?? "").slice(0, 120),
    album: (t.collectionName ?? "").slice(0, 120),
    coverUrl: appleUrl(t.artworkUrl100?.replace(/\/100x100bb\./, "/600x600bb.")),
    previewUrl: appleUrl(t.previewUrl),
    url: appleUrl(t.trackViewUrl) ?? "",
  };
}

/** Songs matching the words: the Vietnamese store first, which carries most of the world's music too. */
export async function searchSongs(term: string, signal?: AbortSignal): Promise<SongResult[]> {
  for (const country of ["VN", "US"]) {
    const res = await fetch(itunesSearchUrl(term, country), { signal });
    if (!res.ok) throw new Error(`music search ${res.status}`);
    const data = (await res.json()) as { results?: ITunesTrack[] };
    const found = (data.results ?? []).map(toSongResult).filter((r): r is SongResult => r !== null);
    if (found.length > 0 || country === "US") return found;
  }
  return [];
}

const appleLink = z
  .string()
  .max(1000)
  .refine((u) => appleUrl(u) !== null, "only Apple's music links");

/** The song a writer picked, as the browser sends it. Every link must be one of Apple's. */
export const songPick = z.object({
  id: z.number().int().positive().max(1e12),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120),
  coverUrl: appleLink.nullable(),
  previewUrl: appleLink.nullable(),
  url: z.union([appleLink, z.literal("")]),
});
export type SongPick = z.infer<typeof songPick>;

/** The parts of a picked song that are kept on a note or a shout. */
export const toSticker = (s: SongPick): SongSticker => ({
  title: s.title,
  artist: s.artist,
  url: s.url,
  coverUrl: s.coverUrl,
  previewUrl: s.previewUrl,
});
