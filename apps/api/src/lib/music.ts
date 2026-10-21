import type { NowPlaying } from "@4me/shared";

const recentCache = new Map<string, { at: number; value: NowPlaying[] }>();

/**
 * A member's latest plays on Last.fm, newest first (the first may be playing right now), cached for 30 seconds per
 * isolate. One request serves both the "listening to" line and the mixtape's "lately" songs.
 */
async function lastfmRecent(apiKey: string | undefined, user: string | undefined): Promise<NowPlaying[]> {
  if (!apiKey || !user) return [];
  const hit = recentCache.get(user);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let value: NowPlaying[] = [];
  try {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&format=json&limit=20&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(apiKey)}`,
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
      value = (data.recenttracks?.track ?? []).map((t) => ({
        artist: t.artist?.["#text"] ?? "",
        title: t.name,
        url: t.url,
        image: t.image?.find((i) => i.size === "medium")?.["#text"] || null,
        live: t["@attr"]?.nowplaying === "true",
      }));
    } else value = hit?.value ?? [];
  } catch {
    value = hit?.value ?? [];
  }
  if (recentCache.size > 500) recentCache.clear();
  recentCache.set(user, { at: Date.now(), value });
  return value;
}

/** What a member is listening to right now (or last played), from Last.fm. */
export async function nowPlaying(apiKey: string | undefined, user: string | undefined): Promise<NowPlaying | null> {
  return (await lastfmRecent(apiKey, user))[0] ?? null;
}

/** A member's last few different songs on Last.fm, not counting the one playing now: the mixtape's "lately". */
export async function lately(apiKey: string | undefined, user: string | undefined, max = 10): Promise<NowPlaying[]> {
  const seen = new Set<string>();
  const out: NowPlaying[] = [];
  for (const t of await lastfmRecent(apiKey, user)) {
    const key = `${t.artist}|${t.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!t.live) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
