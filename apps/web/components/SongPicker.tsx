"use client";

import { type SongResult, searchSongs } from "@4me/shared";
import { useEffect, useRef, useState } from "react";
import { IconPause, IconPlay } from "./Icons";

/** The song on a page being written. `id` is null for an older song that was not picked from the search. */
export type PickedSong = {
  id: number | null;
  title: string;
  artist: string;
  coverUrl: string | null;
  previewUrl: string | null;
  url: string;
};

/** One shared player for every 30-second preview in the picker, so only one ever plays. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  const toggle = (url: string | null) => {
    if (!url) return;
    audio.current ??= new Audio();
    const a = audio.current;
    if (playing === url) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = url;
    a.onended = () => setPlaying(null);
    void a.play().then(
      () => setPlaying(url),
      () => setPlaying(null),
    );
  };
  return { playing, toggle };
}

/** Search the music library, listen to the 30-second preview, pick one: the song sticker on a page. */
export function SongPicker({
  value,
  onChange,
}: {
  value: PickedSong | null;
  onChange: (s: PickedSong | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SongResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const preview = usePreview();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      setState("loading");
      try {
        // Straight from this browser to Apple's music search (Apple turns many cloud servers away).
        setResults((await searchSongs(term, ctl.signal)).slice(0, 8));
        setState("idle");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError("the search isn't answering, try again");
          setState("error");
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  if (value) {
    return (
      <div className="song-picked">
        {value.coverUrl ? <img src={value.coverUrl} alt="" width={48} height={48} /> : <span className="song-blank" />}
        <span className="song-meta">
          <b>{value.title}</b>
          <small>{value.artist}</small>
        </span>
        {value.previewUrl && (
          <button
            type="button"
            className="btn song-play"
            aria-label={preview.playing === value.previewUrl ? "Stop the preview" : "Play the preview"}
            onClick={() => preview.toggle(value.previewUrl)}
          >
            {preview.playing === value.previewUrl ? <IconPause /> : <IconPlay />}
          </button>
        )}
        <button type="button" className="btn" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="song-search">
      <input
        className="field"
        type="search"
        placeholder="search a song or an artist…"
        aria-label="Search for a song"
        value={q}
        maxLength={80}
        onChange={(e) => setQ(e.target.value)}
      />
      {state === "loading" && <p className="song-note">Looking…</p>}
      {state === "error" && (
        <p className="song-note err" role="alert">
          {error}
        </p>
      )}
      {state === "idle" && q.trim().length >= 2 && results.length === 0 && (
        <p className="song-note">Nothing found. Try the artist&apos;s name.</p>
      )}
      {results.length > 0 && (
        <ul className="song-results">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="song-pick"
                onClick={() => {
                  onChange({
                    id: r.id,
                    title: r.title,
                    artist: r.artist,
                    coverUrl: r.coverUrl,
                    previewUrl: r.previewUrl,
                    url: r.url,
                  });
                  setQ("");
                }}
              >
                {r.coverUrl ? <img src={r.coverUrl} alt="" width={40} height={40} /> : <span className="song-blank" />}
                <span className="song-meta">
                  <b>{r.title}</b>
                  <small>
                    {r.artist}
                    {r.album && ` · ${r.album}`}
                  </small>
                </span>
              </button>
              {r.previewUrl && (
                <button
                  type="button"
                  className="btn song-play"
                  aria-label={`${preview.playing === r.previewUrl ? "Stop" : "Play"} a preview of ${r.title}`}
                  onClick={() => preview.toggle(r.previewUrl)}
                >
                  {preview.playing === r.previewUrl ? <IconPause /> : <IconPlay />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
