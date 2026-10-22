"use client";

import type { SongPick, SongSticker as Sticker } from "@4me/shared";
import { useState } from "react";
import { useClip } from "@/lib/clip";
import { IconPause, IconPlay } from "./Icons";
import { type PickedSong, SongPicker } from "./SongPicker";

/** A song stuck on a note or a shout: its cover, its name, and its 30-second clip. */
export function SongSticker({ song }: { song: Sticker }) {
  const clip = useClip();
  const on = Boolean(song.previewUrl) && clip.playing === song.previewUrl;
  const name = `${song.title}${song.artist ? ` · ${song.artist}` : ""}`;
  return (
    <span className={`sticker${on ? " on" : ""}`}>
      {song.coverUrl ? <img src={song.coverUrl} alt="" width={28} height={28} /> : <span className="sticker-blank" />}
      {song.url ? (
        <a href={song.url} target="_blank" rel="noopener noreferrer" title={`${name} on Apple Music`}>
          {name}
        </a>
      ) : (
        <span>{name}</span>
      )}
      {song.previewUrl && (
        <button
          type="button"
          className="sticker-play"
          aria-label={on ? `Stop ${song.title}` : `Play 30 seconds of ${song.title}`}
          onClick={() => clip.toggle(song.previewUrl)}
        >
          {on ? <IconPause /> : <IconPlay />}
        </button>
      )}
    </span>
  );
}

/** The song as the API takes it; older songs without a search id can't be stuck on anything. */
export const toPick = (s: PickedSong | null): SongPick | undefined =>
  s?.id
    ? { id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, previewUrl: s.previewUrl, url: s.url }
    : undefined;

/** "♪ add a song" under a note or a shout: it opens the small music search, and shows the song once picked. */
export function AddSong({ value, onChange }: { value: PickedSong | null; onChange: (s: PickedSong | null) => void }) {
  const [open, setOpen] = useState(false);
  if (value || open)
    return (
      <div className="add-song">
        <SongPicker compact value={value} onChange={onChange} />
        <button
          type="button"
          className="linkish"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          {value ? "no song" : "never mind"}
        </button>
      </div>
    );
  return (
    <button type="button" className="linkish add-song-open" onClick={() => setOpen(true)}>
      ♪ add a song
    </button>
  );
}
