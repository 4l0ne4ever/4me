import type { NowPlaying, Song } from "@4me/shared";

type OEmbed = { title?: string; author_name?: string; thumbnail_url?: string; html?: string };

async function oembed(endpoint: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}

function iframeSrc(html: string | undefined): string | null {
  const m = html?.match(/src="([^"]+)"/);
  return m?.[1] ?? null;
}

/**
 * Turns a Spotify, YouTube or SoundCloud link into song details and an embeddable player URL.
 * Anything the author typed by hand wins over what the provider reports.
 */
export async function resolveSong(url: string, title?: string, artist?: string): Promise<Song> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { title: title || url, artist: artist || "", url, embedUrl: null, coverUrl: null };
  }
  const host = u.hostname.replace(/^www\./, "");
  let found: OEmbed | null = null;
  let embedUrl: string | null = null;

  if (host === "open.spotify.com") {
    found = await oembed(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    const m = u.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
    if (m) embedUrl = `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  } else if (
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "music.youtube.com" ||
    host === "m.youtube.com"
  ) {
    found = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v");
    if (id && /^[\w-]{6,20}$/.test(id)) embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
  } else if (host === "soundcloud.com") {
    found = await oembed(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    embedUrl = iframeSrc(found?.html);
  }

  return {
    title: title || found?.title || url,
    artist: artist || found?.author_name || "",
    url,
    embedUrl,
    coverUrl: found?.thumbnail_url ?? null,
  };
}

let nowPlayingCache: { at: number; key: string; value: NowPlaying | null } | null = null;

/** What the author is listening to right now, from Last.fm, cached for 30 seconds per isolate. */
export async function nowPlaying(apiKey: string | undefined, user: string | undefined): Promise<NowPlaying | null> {
  if (!apiKey || !user) return null;
  const key = `${user}`;
  if (nowPlayingCache && nowPlayingCache.key === key && Date.now() - nowPlayingCache.at < 30_000) {
    return nowPlayingCache.value;
  }
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
    value = nowPlayingCache?.value ?? null;
  }
  nowPlayingCache = { at: Date.now(), key, value };
  return value;
}
