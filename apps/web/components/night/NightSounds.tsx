"use client";

import { useEffect, useRef, useState } from "react";
import { PLAYING } from "@/lib/clip";
import { AMBIENTS, type Ambient, duckAmbient, pauseAmbient, setAmbient, setAmbientVolume } from "./ambience";

const STORE = "4me-night-sounds";
type Saved = { on: Ambient[]; volume: number };

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Saved> | null;
    const ids = new Set(AMBIENTS.map((a) => a.id));
    return {
      on: Array.isArray(v?.on) ? v.on.filter((x): x is Ambient => ids.has(x as Ambient)) : [],
      volume: typeof v?.volume === "number" ? Math.max(0, Math.min(1, v.volume)) : 0.6,
    };
  } catch {
    return { on: [], volume: 0.6 };
  }
}

/**
 * The night sounds' panel: four sounds to mix and a volume. What was on last time comes back on with the first
 * click anywhere (browsers won't play anything before that), quieter while music plays, silent in a hidden tab.
 */
export function NightSounds({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [saved, setSaved] = useState<Saved>({ on: [], volume: 0.6 });
  const [started, setStarted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = load();
    setSaved(s);
    setAmbientVolume(s.volume);
    if (!s.on.length) return;
    const wake = () => {
      for (const id of s.on) setAmbient(id, true);
      setStarted(true);
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // Music anywhere on the desktop: the night steps back until it stops.
  useEffect(() => {
    const playing = new Set<string>();
    const on = (e: Event) => {
      const { who, on: now } = (e as CustomEvent<{ who: string; on: boolean }>).detail;
      if (now) playing.add(who);
      else playing.delete(who);
      duckAmbient(playing.size > 0);
    };
    const hidden = () => pauseAmbient(document.hidden);
    window.addEventListener(PLAYING, on);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener(PLAYING, on);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".ns-panel, .ns-btn"))
        onClose();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open, onClose]);

  const save = (next: Saved) => {
    setSaved(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // kept for this visit
    }
  };

  if (!open) return null;
  return (
    <div className="ns-panel" ref={panel} role="dialog" aria-label="Night sounds">
      <header>
        <b>Night sounds</b>
        <span>{saved.on.length ? (started ? "playing softly" : "starts with your next click") : "all quiet"}</span>
      </header>
      <ul>
        {AMBIENTS.map((a) => {
          const on = saved.on.includes(a.id);
          return (
            <li key={a.id}>
              <label className={on ? "on" : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    setAmbient(a.id, e.target.checked);
                    setStarted(true);
                    save({
                      ...saved,
                      on: e.target.checked ? [...saved.on, a.id] : saved.on.filter((x) => x !== a.id),
                    });
                  }}
                />
                <span className="ns-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {a.label}
              </label>
            </li>
          );
        })}
      </ul>
      <label className="ns-vol">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={saved.volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAmbientVolume(v);
            save({ ...saved, volume: v });
          }}
        />
      </label>
      <p className="ns-note">Made in your browser, nothing to download. Quieter while a song plays.</p>
    </div>
  );
}
