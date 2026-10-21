"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useLiveEvent } from "@/lib/live";

// A row of tube houses across the street at blue hour, the kind every Vietnamese city has: narrow, tall, a water
// tank on the roof, wires sagging between them. Each lit window is someone with 4me open right now: a light comes on
// when someone arrives and goes out when they leave.

const W = 240;
const GROUND = 150;
const FLOOR = 21;

type Roof = "tank" | "antenna" | "hut" | "plants" | "tin" | "none";
type House = {
  x: number;
  w: number;
  floors: number;
  roof: Roof;
  shade: number;
  balcony?: boolean;
  shutter?: boolean;
  /** Floors with an air conditioner hung beside the window. */
  ac?: number[];
};

const HOUSES: House[] = [
  { x: 0, w: 31, floors: 4, roof: "tank", shade: 0, ac: [2] },
  { x: 31, w: 25, floors: 5, roof: "antenna", shade: 1, balcony: true },
  { x: 56, w: 35, floors: 3, roof: "tin", shade: 2, shutter: true },
  { x: 91, w: 27, floors: 6, roof: "hut", shade: 0, balcony: true, ac: [1, 4] },
  { x: 118, w: 33, floors: 4, roof: "tank", shade: 2, ac: [3] },
  { x: 151, w: 23, floors: 3, roof: "plants", shade: 1, balcony: true },
  { x: 174, w: 37, floors: 4, roof: "tank", shade: 0, shutter: true, ac: [2] },
  { x: 211, w: 29, floors: 5, roof: "antenna", shade: 1, balcony: true },
];
const SHADES = ["#0a0f18", "#070b12", "#0c121c"];

/** A window, and how its light looks when it is on: a warm bulb, a pale tube light, or a television's blue. */
type Win = { x: number; y: number; w: number; h: number; tone: "warm" | "tube" | "tv"; curtain: boolean };

/** Every window on the street, in a fixed shuffled order so lights come on scattered, not floor by floor. */
function windows(): Win[] {
  const all: Win[] = [];
  for (const h of HOUSES) {
    // The ground floor is a shop with its shutter down, or a door; the rooms are upstairs.
    for (let f = 1; f < h.floors; f++) {
      const y = GROUND - (f + 1) * FLOOR + 6;
      const pair = h.w >= 30;
      const ww = pair ? 9 : h.w - 12;
      const xs = pair ? [h.x + 5, h.x + h.w - 14] : [h.x + 6];
      for (const x of xs) all.push({ x, y, w: ww, h: 11, tone: "warm", curtain: false });
    }
  }
  return all
    .map((w, i) => ({ w, k: (i * 7919) % 101 }))
    .sort((a, b) => a.k - b.k)
    .map(({ w }, i) => ({ ...w, tone: i % 7 === 3 ? "tv" : i % 5 === 1 ? "tube" : "warm", curtain: i % 3 === 0 }));
}

function Roofline({ h }: { h: House }) {
  const top = GROUND - h.floors * FLOOR;
  const mid = h.x + h.w / 2;
  return (
    <g className="sk-roof">
      {/* parapet */}
      <rect x={h.x} y={top - 3} width={h.w} height={3} />
      {h.roof === "tank" && (
        <>
          {/* the steel water tank, lying on its stand */}
          <rect x={mid - 8} y={top - 12} width={16} height={7} rx={3.5} />
          <rect x={mid - 6} y={top - 5} width={1.2} height={2} />
          <rect x={mid + 5} y={top - 5} width={1.2} height={2} />
          <rect x={mid - 6.5} y={top - 11.4} width={13} height={0.7} rx={0.35} className="sk-rim" />
        </>
      )}
      {h.roof === "antenna" && (
        <>
          <rect x={mid} y={top - 22} width={0.8} height={19} />
          <rect x={mid - 5} y={top - 19} width={10} height={0.8} />
          <rect x={mid - 3.5} y={top - 15} width={7} height={0.8} />
        </>
      )}
      {h.roof === "tin" && (
        /* a lean-to of corrugated tin over the roof terrace */
        <path d={`M${h.x} ${top - 3} v-9 L${h.x + h.w} ${top - 6} v3 z`} />
      )}
      {h.roof === "hut" && <path d={`M${h.x + 3} ${top - 3} v-8 h10 l3 4 v4 z`} />}
      {h.roof === "plants" && (
        <path
          d={`M${h.x + 4} ${top - 3} q2 -7 4 0 q2 -9 5 0 q1 -5 3 0 M${h.x + h.w - 10} ${top - 3} q3 -8 6 0`}
          className="sk-leaves"
        />
      )}
    </g>
  );
}

function House({ h }: { h: House }) {
  const top = GROUND - h.floors * FLOOR;
  return (
    <g>
      {/* data-roof: Ink can climb up and sit here */}
      <rect x={h.x} y={top} width={h.w} height={GROUND - top} fill={SHADES[h.shade]} data-roof={h.x} />
      {/* the sky catching the house's left edge, and the shadow where it meets the next */}
      <rect x={h.x} y={top - 3} width={0.6} height={GROUND - top + 3} className="sk-edge" />
      <rect x={h.x + h.w - 1.2} y={top} width={1.2} height={GROUND - top} className="sk-seam" />
      {/* the last of the sky catching the roof edge */}
      <rect x={h.x} y={top - 3} width={h.w} height={0.8} className="sk-rim" />
      <Roofline h={h} />
      {h.balcony &&
        Array.from({ length: h.floors - 1 }, (_, f) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: floors never reorder
            key={f}
            x={h.x - 1}
            y={GROUND - (f + 1) * FLOOR + 18}
            width={h.w + 2}
            height={1.6}
            className="sk-ledge"
          />
        ))}
      {h.balcony &&
        Array.from({ length: h.floors - 1 }, (_, f) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: floors never reorder
            key={`r${f}`}
            d={`M${h.x - 1} ${GROUND - (f + 1) * FLOOR + 14}h${h.w + 2}${Array.from({ length: Math.floor(h.w / 3) }, (_, k) => `M${h.x + 1 + k * 3} ${GROUND - (f + 1) * FLOOR + 14}v4`).join("")}`}
            className="sk-rail"
          />
        ))}
      {h.ac?.map((f) => (
        <rect
          key={`ac${f}`}
          x={h.x + h.w - 7}
          y={GROUND - (f + 1) * FLOOR + 13}
          width={6}
          height={4}
          className="sk-ac"
        />
      ))}
      {h.shutter ? (
        <g className="sk-shutter">
          {[0, 3, 6, 9, 12].map((d) => (
            <rect key={d} x={h.x + 4} y={GROUND - 16 + d} width={h.w - 8} height={1} />
          ))}
        </g>
      ) : (
        <rect x={h.x + h.w / 2 - 4} y={GROUND - 15} width={8} height={15} className="sk-door" />
      )}
    </g>
  );
}

export function Skyline() {
  const [awake, setAwake] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const all = useMemo(windows, []);
  useLiveEvent((e) => {
    if (e.type === "awake") setAwake(e.n);
  });
  // A tapped balloon folds away by itself (Safari never moves focus to a tapped button, so blur alone won't do).
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(false), 7000);
    return () => window.clearTimeout(t);
  }, [shown]);
  if (awake === null) return null;
  const lit = Math.min(awake, all.length);
  const label =
    awake === 1
      ? "Only your window is lit: no one else has 4me open right now."
      : `${awake} windows are lit right now.`;
  return (
    <figure className={`skyline${shown ? " show" : ""}`}>
      <button
        type="button"
        className="sk-hit"
        aria-expanded={shown}
        aria-label={`The street across the way: ${label}`}
        onClick={() => setShown((v) => !v)}
        onBlur={() => setShown(false)}
      >
        <svg viewBox={`0 0 ${W} ${GROUND}`} aria-hidden="true">
          <defs>
            <linearGradient id="sk-warm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe3a3" />
              <stop offset="1" stopColor="#f0a24a" />
            </linearGradient>
            <linearGradient id="sk-tube" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6f4dc" />
              <stop offset="1" stopColor="#cfd8c4" />
            </linearGradient>
            <linearGradient id="sk-tv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#bcd4ff" />
              <stop offset="1" stopColor="#6f93d8" />
            </linearGradient>
            <linearGradient id="sk-mist" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a5a78" stopOpacity="0" />
              <stop offset="1" stopColor="#4a5a78" stopOpacity="0.22" />
            </linearGradient>
            {/* the last light of the sky on the upper floors, night below */}
            <linearGradient id="sk-dusk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8aa3cc" stopOpacity="0.1" />
              <stop offset="0.5" stopColor="#8aa3cc" stopOpacity="0.02" />
              <stop offset="1" stopColor="#000" stopOpacity="0.3" />
            </linearGradient>
            <clipPath id="sk-walls">
              {HOUSES.map((h) => (
                <rect key={h.x} x={h.x} y={GROUND - h.floors * FLOOR} width={h.w} height={h.floors * FLOOR} />
              ))}
            </clipPath>
            <filter id="sk-spill" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
          </defs>

          {HOUSES.map((h) => (
            <House key={h.x} h={h} />
          ))}

          <rect
            x={0}
            y={0}
            width={W}
            height={GROUND}
            fill="url(#sk-dusk)"
            clipPath="url(#sk-walls)"
            className="sk-dusk"
          />

          {/* light spilling onto the walls around each lit window */}
          <g filter="url(#sk-spill)" className="sk-spills">
            {all.slice(0, lit).map((w) => (
              <rect
                key={`s${w.x}-${w.y}`}
                x={w.x - 3}
                y={w.y - 2}
                width={w.w + 6}
                height={w.h + 5}
                className={`sk-spill ${w.tone}`}
              />
            ))}
          </g>

          {all.map((w, i) => {
            const on = i < lit;
            return (
              <g
                key={`${w.x}-${w.y}`}
                className={`sk-win${on ? ` lit ${w.tone}` : ""}`}
                style={{ "--sk-delay": `${(i % 9) * 70}ms` } as CSSProperties}
              >
                <rect x={w.x} y={w.y} width={w.w} height={w.h} className="sk-glass" />
                {on && w.curtain && <rect x={w.x} y={w.y} width={w.w * 0.38} height={w.h} className="sk-curtain" />}
                {on ? (
                  /* the iron grille every window here has */
                  <path
                    d={`M${w.x + w.w / 3} ${w.y}v${w.h}M${w.x + (2 * w.w) / 3} ${w.y}v${w.h}`}
                    className="sk-grille"
                  />
                ) : (
                  /* shutters closed for the night */
                  <path d={`M${w.x} ${w.y + 3.5}h${w.w}M${w.x} ${w.y + 7.5}h${w.w}`} className="sk-louver" />
                )}
              </g>
            );
          })}

          {/* wires sagging from a pole, across the whole street */}
          <rect x={146} y={46} width={1.6} height={GROUND - 46} className="sk-pole" />
          <rect x={141} y={50} width={12} height={1.2} className="sk-pole" />
          <path d={`M0 58 Q74 76 147 51 Q196 66 ${W} 57`} className="sk-wire" />
          <path d={`M0 64 Q70 84 147 55 Q198 74 ${W} 66`} className="sk-wire" />
          <path d="M0 71 Q60 88 152 62" className="sk-wire thin" />
          {/* a sparrow on the wire */}
          <path d="M200 62.4 q2 -2.6 4 -0.4 l1.6 -0.8 l-0.6 1.6 q-2.4 1.8 -5 -0.4 z" className="sk-bird" />

          <rect x={0} y={GROUND - 30} width={W} height={30} fill="url(#sk-mist)" />
        </svg>
      </button>
      {/* a 2006 tooltip balloon: what the lights mean */}
      <figcaption>
        <b>{label}</b>
        Each lit window across the street is someone with 4me open, here or anywhere: a light comes on when they arrive
        and goes out when they leave.
      </figcaption>
    </figure>
  );
}
