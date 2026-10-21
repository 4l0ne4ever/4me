"use client";

import { useMemo, useState } from "react";
import { useLiveEvent } from "@/lib/live";

// Three pixel buildings at the foot of the desktop. Each lit window is someone with 4me open right now: a light
// comes on when someone arrives and goes out when they leave.

type Win = { x: number; y: number };
const BUILDINGS = [
  { x: 0, w: 46, h: 70, cols: 3, rows: 5 },
  { x: 50, w: 62, h: 96, cols: 4, rows: 7 },
  { x: 116, w: 40, h: 58, cols: 2, rows: 4 },
];

/** Every window on the skyline, in a fixed shuffled order so lights come on scattered, not row by row. */
function windows(): Win[] {
  const all: Win[] = [];
  for (const b of BUILDINGS)
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++) all.push({ x: b.x + 7 + c * 13, y: 100 - b.h + 8 + r * 12 });
  // A fixed shuffle (the same for every visitor), so it reads as a city, not a progress bar.
  return all
    .map((w, i) => ({ w, k: (i * 7919) % 101 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.w);
}

export function Skyline() {
  const [awake, setAwake] = useState<number | null>(null);
  const all = useMemo(windows, []);
  useLiveEvent((e) => {
    if (e.type === "awake") setAwake(e.n);
  });
  if (awake === null) return null;
  const lit = Math.min(awake, all.length);
  const label = awake === 1 ? "Only your window is lit on 4me right now" : `${awake} windows are lit on 4me right now`;
  return (
    <figure className="skyline" title={label}>
      <svg viewBox="0 0 160 100" aria-hidden="true">
        {BUILDINGS.map((b) => (
          <rect key={b.x} x={b.x} y={100 - b.h} width={b.w} height={b.h} className="sk-building" />
        ))}
        {all.map((w, i) => (
          <rect key={`${w.x}-${w.y}`} x={w.x} y={w.y} width={6} height={7} className={i < lit ? "sk-lit" : "sk-dark"} />
        ))}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
