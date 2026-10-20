"use client";

import type { EntrySummary, NowPlaying, Song } from "@4me/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconNext, IconPause, IconPlay, IconPrev } from "../Icons";

type Track = Song & { night: number };

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function searchUrl(t: Track) {
  return `https://open.spotify.com/search/${encodeURIComponent(`${t.artist} ${t.title}`.trim())}`;
}

/** What the author is playing on Last.fm, shown above the playlist (and even when the playlist is empty). */
function Live({ live }: { live: NowPlaying | null }) {
  if (!live) return null;
  return (
    <p className="live">
      <span className="dot" style={{ background: live.live ? "var(--ok)" : "var(--away)" }} />
      <span>
        {live.live ? "4me is listening to" : "4me last played"}{" "}
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
}: {
  entries: EntrySummary[];
  currentId?: number;
  live: NowPlaying | null;
}) {
  const tracks = useMemo<Track[]>(() => {
    const seen = new Set<string>();
    return entries.flatMap((e) => {
      if (!e.song) return [];
      const key = `${e.song.artist}|${e.song.title}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...e.song, night: e.id }];
    });
  }, [entries]);
  const startAt = Math.max(
    0,
    tracks.findIndex((t) => t.night === currentId),
  );
  const [i, setI] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [sec, setSec] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const track = tracks[i];
  const clip = track?.previewUrl ?? null;

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
    setI((n + tracks.length) % tracks.length);
    setSec(0);
  };

  if (!track) {
    return (
      <div className="amp">
        <Live live={live} />
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
      <Live live={live} />
      <div className="lcd">
        <span className="time">{fmt(sec)}</span>
        <span className="scroll">
          <span>
            *** {i + 1}. {track.artist} – {track.title}
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
      {playing &&
        !clip &&
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
                {n + 1}. {t.artist} – {t.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
