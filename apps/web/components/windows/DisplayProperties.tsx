"use client";

import { type CSSProperties, type DragEvent, useEffect, useState } from "react";
import {
  type Background,
  COLORS,
  FITS,
  type Fit,
  PRESETS,
  rejectFile,
  resolveBackground,
  type WallpaperPref,
} from "@/lib/wallpaper";
import { shrink } from "@/lib/wallpaper-store";

type Props = {
  pref: WallpaperPref;
  skinWall: string;
  uploadUrl: string | null;
  onApply: (pref: WallpaperPref) => void;
  onClose: () => void;
  onUpload: (picture: Blob) => Promise<void>;
  onRemoveUpload: () => Promise<void>;
  /** How big the words in every window are; applied at once, kept in this browser. */
  textSize: "normal" | "large";
  onTextSize: (size: "normal" | "large") => void;
};

type Option = { key: string; label: string; swatch: CSSProperties; pref: WallpaperPref["wallpaper"] };

export function paintStyle(bg: Background): CSSProperties {
  if (bg.kind === "color") return { backgroundColor: bg.color };
  const size = bg.fit === "fill" ? "cover" : bg.fit === "fit" ? "contain" : "auto";
  return {
    backgroundImage: `url("${bg.url}")`,
    backgroundSize: size,
    backgroundRepeat: bg.fit === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: bg.fit === "tile" ? "0 0" : "center",
  };
}

const keyOf = (w: WallpaperPref["wallpaper"]) =>
  w.source === "preset" || w.source === "color" ? `${w.source}:${w.id}` : w.source;

/** Windows XP's Display Properties, Desktop tab: pick a picture, a colour, or your own file. */
export function DisplayProperties({
  pref,
  skinWall,
  uploadUrl,
  onApply,
  onClose,
  onUpload,
  onRemoveUpload,
  textSize,
  onTextSize,
}: Props) {
  const [draft, setDraft] = useState(pref);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => setDraft(pref), [pref]);

  const options: Option[] = [
    { key: "skin", label: "(Skin default)", swatch: thumb(skinWall), pref: { source: "skin" } },
    ...PRESETS.map((p) => ({
      key: `preset:${p.id}`,
      label: p.name,
      swatch: thumb(p.url),
      pref: { source: "preset" as const, id: p.id },
    })),
    ...(uploadUrl
      ? [{ key: "upload", label: "My picture", swatch: thumb(uploadUrl), pref: { source: "upload" as const } }]
      : []),
    ...COLORS.map((c) => ({
      key: `color:${c.id}`,
      label: c.name,
      swatch: { backgroundColor: c.color },
      pref: { source: "color" as const, id: c.id },
    })),
  ];

  const preview = resolveBackground(draft, { skinWall, dayWall: skinWall, awake: true, uploadUrl });
  const isColor = draft.wallpaper.source === "color";
  const changed = JSON.stringify(draft) !== JSON.stringify(pref);

  const take = async (file: File | undefined) => {
    if (!file) return;
    const problem = rejectFile(file);
    if (problem) return setMessage(problem);
    setBusy(true);
    setMessage("Getting your picture ready…");
    try {
      await onUpload(await shrink(file));
      setDraft((d) => ({ ...d, wallpaper: { source: "upload" } }));
      setMessage("Your picture is ready. Press OK or Apply to use it.");
    } catch {
      setMessage("Couldn't open that picture. Try another file, or a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <>
      <div className="body disp">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop zone for files; Browse… is the keyboard way in */}
        <div
          className={`monitor${dragging ? " drop" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="screen" style={paintStyle(preview)}>
            {dragging && <span>Drop it here</span>}
          </div>
          <i className="stand" />
        </div>

        <div className="disp-row">
          <fieldset className="bg-list">
            <legend>Background</legend>
            {options.map((o) => (
              <label key={o.key} className={keyOf(draft.wallpaper) === o.key ? "on" : undefined}>
                <input
                  type="radio"
                  name="background"
                  value={o.key}
                  checked={keyOf(draft.wallpaper) === o.key}
                  onChange={() => setDraft((d) => ({ ...d, wallpaper: o.pref }))}
                />
                <i style={o.swatch} />
                {o.label}
              </label>
            ))}
          </fieldset>

          <div className="disp-side">
            <label className="btn file-btn" aria-disabled={busy}>
              Browse…
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                disabled={busy}
                onChange={(e) => {
                  void take(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="disp-field">
              Position
              <select
                className="field"
                value={draft.fit}
                disabled={isColor || draft.wallpaper.source === "skin"}
                onChange={(e) => setDraft((d) => ({ ...d, fit: e.target.value as Fit }))}
              >
                {FITS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {uploadUrl && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await onRemoveUpload();
                  if (draft.wallpaper.source === "upload") setDraft((d) => ({ ...d, wallpaper: { source: "skin" } }));
                  setMessage("Your picture is gone from this browser.");
                }}
              >
                Remove my picture
              </button>
            )}
          </div>
        </div>

        <fieldset className="disp-text">
          <legend>Text size</legend>
          {(["normal", "large"] as const).map((size) => (
            <label key={size} className={textSize === size ? "on" : undefined}>
              <input type="radio" name="text-size" checked={textSize === size} onChange={() => onTextSize(size)} />
              <span className={`disp-text-${size}`}>Aa</span>
              {size === "normal" ? "Normal" : "Large"}
            </label>
          ))}
        </fieldset>

        <p className="disp-hint">
          Pick one, drop a picture on the screen, or browse for a file. Your picture stays in this browser and is never
          uploaded; other readers see their own desktop.
        </p>
        {message && (
          <p className="disp-msg" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="disp-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          OK
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy || !changed} onClick={() => onApply(draft)}>
          Apply
        </button>
      </div>
    </>
  );
}

function thumb(url: string): CSSProperties {
  return { backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" };
}
