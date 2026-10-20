"use client";

import type { Author, EntrySummary, NowPlaying, Song, SongResult } from "@4me/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { IconNext, IconPause, IconPlay, IconPrev } from "../Icons";

/** `live` marks what the writer is playing on Last.fm right now; its preview is found when it is played. */
type Track = Song & { night: number; live?: boolean };
type Found = { key: string; url: string | null };

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function searchUrl(t: Track) {
  return `https://open.spotify.com/search/${encodeURIComponent(`${t.artist} ${t.title}`.trim())}`;
}

/** What the writer is playing on Last.fm, shown above the playlist (and even when the playlist is empty). */
function Live({ live, who }: { live: NowPlaying | null; who: string }) {
  if (!live) return null;
  return (
    <p className="live">
      <span className="dot" style={{ background: live.live ? "var(--ok)" : "var(--away)" }} />
      <span>
        {who} {live.live ? "is listening to" : "last played"}{" "}
        <b>
          {live.artist} – {live.title}
        </b>
      </span>
    </p>
  );
}

/**
 * Every song pinned to a night, as one playlist. Songs picked from the music search play their 30-second preview
 * right here; older ones with a Spotify, YouTube or SoundCloud link play in that provider's embed.
 */
export function Mixtape({
  entries,
  currentId,
  live,
  persona,
}: {
  entries: EntrySummary[];
  currentId?: number;
  live: NowPlaying | null;
  persona: Author | null;
}) {
  const liveKey = live ? `${live.artist}|${live.title}` : null;
  // Last.fm is asked again every minute; only a new song (liveKey) changes the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `live` is read through liveKey
  const tracks = useMemo<Track[]>(() => {
    const seen = new Set<string>();
    const list: Track[] = [];
    if (live && liveKey) {
      seen.add(liveKey);
      list.push({
        title: live.title,
        artist: live.artist,
        url: live.url,
        embedUrl: null,
        coverUrl: live.image,
        previewUrl: null,
        night: -1,
        live: true,
      });
    }
    for (const e of entries) {
      if (!e.song) continue;
      const key = `${e.song.artist}|${e.song.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...e.song, night: e.id });
    }
    return list;
  }, [entries, liveKey]);
  // The song is remembered by name, not position: the Last.fm song can arrive (or change) after the list is drawn.
  const keyOf = (t: Track | undefined) => (t ? `${t.artist}|${t.title}` : "");
  const [picked, setPicked] = useState<string | null>(null);
  const opening = tracks.findIndex((t) => t.night === currentId);
  const at = picked === null ? -1 : tracks.findIndex((t) => keyOf(t) === picked);
  const i = at >= 0 ? at : Math.max(0, opening);
  const [playing, setPlaying] = useState(false);
  const [sec, setSec] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const [found, setFound] = useState<Found | null>(null);
  const track = tracks[i];
  const trackKey = track ? `${track.artist}|${track.title}` : "";
  const clip = track?.live ? (found?.key === trackKey ? found.url : null) : (track?.previewUrl ?? null);
  const looking = Boolean(playing && track?.live && found?.key !== trackKey);

  // The song playing on Last.fm has no preview of its own: find it in the music search the first time it plays.
  useEffect(() => {
    if (!looking || !track) return;
    const ctl = new AbortController();
    fetch(`${API_URL}/music/search?q=${encodeURIComponent(`${track.artist} ${track.title}`.slice(0, 80))}`, {
      signal: ctl.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<SongResult[]>) : []))
      .then((hits) => {
        const url = hits.find((h) => h.previewUrl)?.previewUrl ?? null;
        setFound({ key: `${track.artist}|${track.title}`, url });
        if (!url) setPlaying(false);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setPlaying(false);
      });
    return () => ctl.abort();
  }, [looking, track]);

  // The preview plays in the page; its own clock drives the display.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (playing && clip) {
      if (a.src !== clip) a.src = clip;
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  }, [playing, clip]);

  // Embedded players keep their own time; the display just counts along.
  useEffect(() => {
    if (!playing || clip) return;
    const t = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [playing, clip]);

  const go = (n: number) => {
    setPicked(keyOf(tracks[(n + tracks.length) % tracks.length]));
    setSec(0);
  };

  const who = persona?.name ?? "4me";

  if (!track) {
    return (
      <div className="amp">
        <Live live={live} who={who} />
        <div className="lcd">
          <span className="time">--:--</span>
          <span className="scroll">
            <span>*** no songs yet ***</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`amp${playing ? "" : " paused"}`}>
      <Live live={live} who={who} />
      <div className="lcd">
        <span className="time">{fmt(sec)}</span>
        <span className="scroll">
          <span>
            *** {track.live ? "now" : i + (tracks[0]?.live ? 0 : 1)}. {track.artist} – {track.title}
            {clip ? " (30 sec)" : ""} ***
          </span>
        </span>
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="ctrls">
        <button className="btn" type="button" aria-label="Previous song" onClick={() => go(i - 1)}>
          <IconPrev />
        </button>
        <button
          className="btn"
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button className="btn" type="button" aria-label="Next song" onClick={() => go(i + 1)}>
          <IconNext />
        </button>
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: 30-second music previews have no words to caption */}
      <audio
        ref={audio}
        preload="none"
        onTimeUpdate={(e) => setSec(Math.floor(e.currentTarget.currentTime))}
        onEnded={() => (tracks.length > 1 ? go(i + 1) : setPlaying(false))}
      />
      {track.live && (looking || found?.key === trackKey) && !clip && (
        <p className="live">
          <span>
            {looking ? (
              "Looking for a preview…"
            ) : (
              <>
                No preview for this one.{" "}
                <a href={searchUrl(track)} target="_blank" rel="noreferrer">
                  Find it on Spotify
                </a>
              </>
            )}
          </span>
        </p>
      )}
      {playing &&
        !clip &&
        !track.live &&
        (track.embedUrl ? (
          <iframe
            key={track.embedUrl}
            className="player"
            src={track.embedUrl}
            title={`${track.artist} – ${track.title}`}
            height={track.embedUrl.includes("spotify") ? 80 : 180}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        ) : (
          <p className="live">
            No player for this one.{" "}
            <a href={track.url || searchUrl(track)} target="_blank" rel="noreferrer">
              Find it on {track.url ? "its page" : "Spotify"}
            </a>
          </p>
        ))}
      {clip && (
        <p className="live">
          <span>
            A 30-second preview.{" "}
            <a href={searchUrl(track)} target="_blank" rel="noreferrer">
              The whole song on Spotify
            </a>
            {track.url && (
              <>
                {" · "}
                <a href={track.url} target="_blank" rel="noreferrer">
                  Apple Music
                </a>
              </>
            )}
          </span>
        </p>
      )}
      <ul className="plist">
        {tracks.map((t, n) => (
          <li key={`${t.artist}-${t.title}`}>
            <button
              type="button"
              aria-current={n === i}
              onClick={() => {
                go(n);
                setPlaying(true);
              }}
            >
              <span>
                {t.live ? "now" : n + (tracks[0]?.live ? 0 : 1)}. {t.artist} – {t.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
