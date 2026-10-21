import type { NowPlaying } from "@4me/shared";

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
