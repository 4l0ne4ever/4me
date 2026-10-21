"use client";

import { type Author, type EntrySummary, type NowPlaying, type Song, searchSongs } from "@4me/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { IconNext, IconPause, IconPlay, IconPrev } from "../Icons";

/** `live` marks what the writer is playing on Last.fm right now; its preview is found by searching for it. */
type Track = Song & { night: number; live?: boolean };
/** How a track plays: a YouTube video (the whole song), its 30-second preview, or not at all. */
type Source = { videoId: string | null; preview: string | null };

type YTPlayer = {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      host: string;
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, number>;
      events: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** YouTube's player API, loaded once, the first time a whole song is played. */
let ytReady: Promise<YTNamespace> | null = null;
function loadYouTube(): Promise<YTNamespace> {
  ytReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => window.YT && resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return ytReady;
}

const keyOf = (t: { artist: string; title: string } | undefined) => (t ? `${t.artist}|${t.title}` : "");

function fmt(s: number) {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
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
 * Every song pinned to a night, as one playlist. A song plays whole through YouTube's player when a video for it is
 * found, and as Apple's 30-second preview otherwise. Each song's source is looked up before it is pressed, so the
 * press itself starts the music (Safari only plays sound started directly by a click or tap).
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
  const liveKey = live ? keyOf(live) : null;
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
      const key = keyOf(e.song);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...e.song, night: e.id });
    }
    return list;
  }, [entries, liveKey]);

  // The song is remembered by name, not position: the Last.fm song can arrive (or change) after the list is drawn.
  const [picked, setPicked] = useState<string | null>(null);
  const opening = tracks.findIndex((t) => t.night === currentId);
  const at = picked === null ? -1 : tracks.findIndex((t) => keyOf(t) === picked);
  const i = at >= 0 ? at : Math.max(0, opening);
  const track = tracks[i];

  const [sources, setSources] = useState<Record<string, Source>>({});
  const [playing, setPlaying] = useState(false);
  const [sec, setSec] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const playerVideo = useRef<string | null>(null);
  const goNext = useRef<() => void>(() => undefined);
  const asked = useRef(new Set<string>());

  /* look every song's source up ahead of time: a YouTube video, and for the Last.fm song its preview too */
  useEffect(() => {
    let alive = true;
    for (const t of tracks) {
      const k = keyOf(t);
      if (asked.current.has(k)) continue;
      asked.current.add(k);
      const video = fetch(
        `${API_URL}/music/video?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}`,
      )
        .then((r) => (r.ok ? (r.json() as Promise<{ videoId: string | null }>) : { videoId: null }))
        .then((r) => r.videoId)
        .catch(() => null);
      const preview = t.previewUrl
        ? Promise.resolve(t.previewUrl)
        : searchSongs(`${t.artist} ${t.title}`)
            .then((hits) => hits.find((h) => h.previewUrl)?.previewUrl ?? null)
            .catch(() => null);
      void Promise.all([video, preview]).then(([videoId, p]) => {
        if (alive) setSources((s) => ({ ...s, [k]: { videoId, preview: p } }));
      });
    }
    return () => {
      alive = false;
    };
  }, [tracks]);

  const source = track ? sources[keyOf(track)] : undefined;
  const mode: "video" | "preview" | "none" | "looking" = !source
    ? "looking"
    : source.videoId
      ? "video"
      : source.preview
        ? "preview"
        : "none";

  /* the clock: YouTube's player keeps its own time; the preview reports it through onTimeUpdate */
  useEffect(() => {
    if (!playing || mode !== "video") return;
    const t = window.setInterval(() => setSec(player.current?.getCurrentTime?.() ?? 0), 500);
    return () => window.clearInterval(t);
  }, [playing, mode]);

  useEffect(
    () => () => {
      player.current?.destroy();
      audio.current?.pause();
    },
    [],
  );

  /** Starts a track. Runs inside the click, so the browser lets the sound start. */
  const start = useCallback(
    (t: Track | undefined) => {
      if (!t) return;
      const s = sources[keyOf(t)];
      setSec(0);
      setBlocked(false);
      if (s?.videoId) {
        audio.current?.pause();
        setPlaying(true);
        if (player.current && playerVideo.current === s.videoId) return player.current.playVideo();
        if (player.current) {
          playerVideo.current = s.videoId;
          return player.current.loadVideoById(s.videoId);
        }
        const id = s.videoId;
        playerVideo.current = id;
        void loadYouTube().then((YT) => {
          if (!box.current) return;
          const holder = document.createElement("div");
          box.current.replaceChildren(holder);
          player.current = new YT.Player(holder, {
            host: "https://www.youtube-nocookie.com",
            videoId: id,
            width: "100%",
            height: "100%",
            playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
            events: {
              onReady: (e) => e.target.playVideo(),
              // 0 ended, 1 playing, 2 paused
              onStateChange: (e) => {
                if (e.data === 0) goNext.current();
                if (e.data === 1) {
                  setPlaying(true);
                  setBlocked(false);
                }
                if (e.data === 2) setPlaying(false);
              },
            },
          });
          // If the browser keeps the sound off until the video itself is tapped, say so.
          window.setTimeout(() => setBlocked((b) => b || (player.current?.getCurrentTime?.() ?? 0) === 0), 3000);
        });
        return;
      }
      player.current?.pauseVideo();
      const a = audio.current;
      if (!s?.preview || !a) return setPlaying(false);
      a.src = s.preview;
      void a.play().then(
        () => setPlaying(true),
        () => {
          setPlaying(false);
          setBlocked(true);
        },
      );
    },
    [sources],
  );

  const go = (n: number) => {
    const next = tracks[(n + tracks.length) % tracks.length];
    setPicked(keyOf(next));
    start(next);
  };
  goNext.current = () => (tracks.length > 1 ? go(i + 1) : setPlaying(false));

  const toggle = () => {
    if (playing) {
      player.current?.pauseVideo();
      audio.current?.pause();
      setPlaying(false);
    } else start(track);
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

  const num = (t: Track, n: number) => (t.live ? "now" : n + (tracks[0]?.live ? 0 : 1));
  return (
    <div className={`amp${playing ? "" : " paused"}`}>
      <Live live={live} who={who} />
      <div className="lcd">
        <span className="time">{fmt(sec)}</span>
        <span className="scroll">
          <span>
            *** {num(track, i)}. {track.artist} – {track.title}
            {mode === "preview" ? " (30 sec)" : ""} ***
          </span>
        </span>
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      {/* YouTube's own player, shown (as YouTube asks) while a whole song plays through it */}
      <div className={`amp-video${mode === "video" && playerVideo.current ? "" : " empty"}`} ref={box} />
      <div className="ctrls">
        <button className="btn" type="button" aria-label="Previous song" onClick={() => go(i - 1)}>
          <IconPrev />
        </button>
        <button
          className="btn"
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={mode === "looking" || mode === "none"}
          onClick={toggle}
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
        onTimeUpdate={(e) => setSec(e.currentTarget.currentTime)}
        onEnded={() => goNext.current()}
      />
      <p className="live">
        <span>
          {mode === "looking" && "Finding this song…"}
          {mode === "video" && "The whole song, through YouTube. "}
          {mode === "preview" && "A 30-second preview (no full version found). "}
          {mode === "none" && "This one can't be played here. "}
          {blocked && "Your browser kept the sound off: press play again, or tap the video. "}
          {mode !== "looking" && (
            <a href={searchUrl(track)} target="_blank" rel="noreferrer">
              Open in Spotify
            </a>
          )}
        </span>
      </p>
      <ul className="plist">
        {tracks.map((t, n) => (
          <li key={keyOf(t)}>
            <button type="button" aria-current={n === i} onClick={() => go(n)}>
              <span>
                {num(t, n)}. {t.artist} – {t.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
