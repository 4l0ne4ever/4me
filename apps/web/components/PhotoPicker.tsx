"use client";

import { useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { shrink } from "@/lib/wallpaper-store";
import { uploadTicket } from "@/lib/writer-actions";

/** A photo on a page being written: `path` is what is saved, `src` what the browser shows. */
export type DraftPhoto = { path: string; src: string; caption: string };

export const MAX_PHOTOS = 12;
const MAX_SIDE = 2048;

/**
 * Picks photos, shrinks each one in the browser (which also drops EXIF and GPS), and sends it straight to the API
 * with a short-lived ticket from the web server. The API strips metadata again before storing it.
 */
export function PhotoPicker({
  photos,
  onChange,
  disabled,
}: {
  photos: DraftPhoto[];
  onChange: (next: DraftPhoto[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const ticket = useRef<{ value: string; until: number } | null>(null);
  const [sending, setSending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The latest list, so photos finishing one after another all land.
  const latest = useRef(photos);
  latest.current = photos;

  async function freshTicket(): Promise<string> {
    if (ticket.current && ticket.current.until > Date.now()) return ticket.current.value;
    const res = await uploadTicket();
    if (!res.ok) throw new Error(res.error);
    ticket.current = { value: res.ticket, until: Date.now() + 8 * 60_000 };
    return res.ticket;
  }

  async function send(file: File): Promise<DraftPhoto> {
    let jpeg: Blob;
    try {
      jpeg = await shrink(file, MAX_SIDE);
    } catch {
      throw new Error(`couldn't read ${file.name}; try a JPEG or PNG`);
    }
    const res = await fetch(`${API_URL}/uploads`, {
      method: "POST",
      headers: { "x-upload-ticket": await freshTicket(), "content-type": "image/jpeg" },
      body: jpeg,
    });
    const data = (await res.json().catch(() => ({}))) as { path?: string; url?: string; error?: string };
    if (!res.ok || !data.path || !data.url) {
      if (res.status === 401) ticket.current = null;
      throw new Error(data.error ?? "the photo didn't upload, try again");
    }
    return { path: data.path, src: data.url, caption: "" };
  }

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - latest.current.length;
    const chosen = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (files.length > room) setError(`a page holds ${MAX_PHOTOS} photos at most`);
    setSending((n) => n + chosen.length);
    for (const file of chosen) {
      try {
        const photo = await send(file);
        onChange([...latest.current, photo]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSending((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  const update = (i: number, p: Partial<DraftPhoto>) =>
    onChange(photos.map((photo, j) => (j === i ? { ...photo, ...p } : photo)));
  const move = (i: number, by: number) => {
    const next = [...photos];
    const [it] = next.splice(i, 1);
    if (it) next.splice(Math.max(0, Math.min(next.length, i + by)), 0, it);
    onChange(next);
  };

  return (
    <div className="ph-pick">
      {photos.length > 0 && (
        <ol className="ph-grid">
          {photos.map((p, i) => (
            <li key={p.path}>
              <img src={p.src} alt={p.caption || `photo ${i + 1}`} width={160} height={120} />
              <span className="ph-tag">[photo {i + 1}]</span>
              <input
                className="field"
                placeholder="caption"
                aria-label={`Caption for photo ${i + 1}`}
                maxLength={120}
                value={p.caption}
                onChange={(e) => update(i, { caption: e.target.value })}
              />
              <span className="ph-acts">
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move photo ${i + 1} earlier`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => onChange(photos.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="ph-add">
        <input
          ref={input}
          id="ph-files"
          type="file"
          accept="image/*"
          multiple
          className="sr"
          disabled={disabled || photos.length >= MAX_PHOTOS}
          onChange={(e) => void add(e.target.files)}
        />
        <label htmlFor="ph-files" className="btn" aria-disabled={disabled || photos.length >= MAX_PHOTOS}>
          Add photos…
        </label>
        <small>
          {sending > 0
            ? `Uploading ${sending}…`
            : `${photos.length}/${MAX_PHOTOS}. The first one is the cover. Location data is removed.`}
        </small>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
