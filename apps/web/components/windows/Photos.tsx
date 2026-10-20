"use client";

import type { Photo } from "@4me/shared";
import { useEffect, useState } from "react";
import { IconNext, IconPrev } from "../Icons";

export type Picture = Photo & { night: string };

export function Photos({
  pictures,
  view,
  onView,
}: {
  pictures: Picture[];
  view: number | null;
  onView: (i: number | null) => void;
}) {
  const [show, setShow] = useState(false);
  const n = pictures.length;

  useEffect(() => {
    if (!show || view === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setInterval(() => onView(((view ?? 0) + 1) % n), reduce ? 4000 : 3200);
    return () => window.clearInterval(t);
  }, [show, view, n, onView]);

  // arrow keys move between photos while the viewer is open, unless the reader is typing
  useEffect(() => {
    if (view === null || n === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") onView((view - 1 + n) % n);
      if (e.key === "ArrowRight") onView((view + 1) % n);
      if (e.key === "Escape") onView(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, n, onView]);

  if (n === 0) return <div className="body photos ph-grid">No pictures yet.</div>;

  if (view === null) {
    return (
      <div className="body photos">
        <div className="ph-grid">
          {pictures.map((p, i) => (
            <button key={p.url} type="button" onClick={() => onView(i)}>
              <img src={p.url} alt={p.caption || "a photo from the diary"} width={300} height={300} loading="lazy" />
              <span>{p.caption || p.url.split("/").pop()}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const p = pictures[view]!;
  return (
    <div className="body photos">
      <div className="stage">
        <img key={p.url} src={p.url} alt={p.caption || "a photo from the diary"} width={1000} height={1250} />
      </div>
      <div className="vbar">
        <button
          className="btn"
          type="button"
          onClick={() => {
            setShow(false);
            onView(null);
          }}
        >
          All photos
        </button>
        <span className="cap">{p.caption || p.url.split("/").pop()}</span>
        <button className="btn" type="button" aria-label="Previous photo" onClick={() => onView((view - 1 + n) % n)}>
          <IconPrev />
        </button>
        <button className="btn" type="button" onClick={() => setShow((s) => !s)}>
          {show ? "Stop" : "Slideshow"}
        </button>
        <button className="btn" type="button" aria-label="Next photo" onClick={() => onView((view + 1) % n)}>
          <IconNext />
        </button>
      </div>
    </div>
  );
}
