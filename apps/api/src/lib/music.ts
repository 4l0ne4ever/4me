import type { NowPlaying, Song, SongResult } from "@4me/shared";

// Music comes from the iTunes Search API: free, no key, and every song has a 30-second preview that can play on
// the page, the way a song sticker does on Instagram. https://performance-partners.apple.com/search-api

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

/** Only Apple's own hosts are stored, so a page can never be made to load audio or images from anywhere else. */
function appleUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const ok = u.protocol === "https:" && (u.hostname.endsWith(".apple.com") || u.hostname.endsWith(".mzstatic.com"));
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

function toResult(t: ITunesTrack): SongResult | null {
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

async function itunes(path: string): Promise<SongResult[]> {
  const res = await fetch(`https://itunes.apple.com/${path}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`music search ${res.status}`);
  const data = (await res.json()) as { results?: ITunesTrack[] };
  return (data.results ?? []).map(toResult).filter((r): r is SongResult => r !== null);
}

/** Songs matching what the writer typed. The Vietnamese store first, which also carries most of the world's music. */
export async function searchSongs(term: string, country = "VN"): Promise<SongResult[]> {
  const q = `term=${encodeURIComponent(term)}&media=music&entity=song&limit=15`;
  const found = await itunes(`search?${q}&country=${country}`);
  return found.length > 0 || country === "US" ? found : itunes(`search?${q}&country=US`);
}

/** The song a writer picked, looked up again by its id so nothing the browser sent is stored as is. */
export async function lookupSong(id: number): Promise<(Song & { id: number }) | null> {
  for (const country of ["VN", "US"]) {
    const [hit] = await itunes(`lookup?id=${id}&entity=song&country=${country}`);
    if (hit?.id === id) {
      return {
        id,
        title: hit.title,
        artist: hit.artist,
        url: hit.url,
        embedUrl: null,
        coverUrl: hit.coverUrl,
        previewUrl: hit.previewUrl,
      };
    }
  }
  return null;
}

const nowPlayingCache = new Map<string, { at: number; value: NowPlaying | null }>();

/** What a member is listening to right now, from Last.fm, cached for 30 seconds per isolate. */
export async function nowPlaying(apiKey: string | undefined, user: string | undefined): Promise<NowPlaying | null> {
  if (!apiKey || !user) return null;
  const hit = nowPlayingCache.get(user);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let value: NowPlaying | null = null;
  try {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&format=json&limit=1&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        recenttracks?: {
          track?: Array<{
            name: string;
            url: string;
            artist?: { "#text"?: string };
            image?: Array<{ "#text": string; size: string }>;
            "@attr"?: { nowplaying?: string };
          }>;
        };
      };
      const t = data.recenttracks?.track?.[0];
      if (t) {
        const image = t.image?.find((i) => i.size === "medium")?.["#text"] || null;
        value = {
          artist: t.artist?.["#text"] ?? "",
          title: t.name,
          url: t.url,
          image,
          live: t["@attr"]?.nowplaying === "true",
        };
      }
    }
  } catch {
    value = hit?.value ?? null;
  }
  if (nowPlayingCache.size > 500) nowPlayingCache.clear();
  nowPlayingCache.set(user, { at: Date.now(), value });
  return value;
}
