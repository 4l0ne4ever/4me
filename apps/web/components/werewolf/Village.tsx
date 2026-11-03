"use client";

import type { PlayerView, TableView } from "@4me/shared";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ROLE_SHORT, RoleIcon } from "./RoleIcon";

// The table, drawn as a village around its square at the foot of the sky: each player is a house on the ring, the
// viewer's own at the front. The sky is the clock: the moon (or the sun, by day) crosses it as the phase runs out.
// Houses are drawn like the desktop's skyline (narrow tube houses, a water tank or an antenna on the roof); every
// house is also a button, for choosing someone.

export type Sky = "lobby" | "night" | "dawn" | "day" | "dusk";

export function skyOf(phase: TableView["phase"] | null): Sky {
  switch (phase) {
    case "deal":
    case "night":
    case "witch":
      return "night";
    case "dawn":
    case "over":
      return "dawn";
    case "verdict":
      return "dusk";
    case null:
    case "lobby":
      return "lobby";
    default:
      return "day";
  }
}

type Spot = { x: number; y: number; s: number; p: PlayerView | null; seat: number };

const W = 480;
const H = 300;
const ring = (compact: boolean) =>
  compact ? { cx: 240, cy: 192, rx: 186, ry: 84 } : { cx: 240, cy: 196, rx: 206, ry: 68 };

/**
 * Places seats on the ring with the viewer at the front and the far side smaller. Seats are spaced evenly along the
 * ring's edge rather than by angle, so the two ends of the ring don't stack houses on top of each other.
 */
function layout(seats: Array<PlayerView | null>, mine: number, compact: boolean): Spot[] {
  const n = seats.length;
  // A narrow window: two rows facing each other across the square, like a street, so the houses stand side by side
  // with room for their names and tallies (on a narrow ring the ends crowd each other).
  if (compact) return street(seats, mine);
  const { cx, cy, rx, ry } = ring(compact);
  const STEPS = 720;
  const pts: Array<{ x: number; y: number; d: number }> = [];
  let d = 0;
  for (let k = 0; k <= STEPS; k++) {
    // from the front (the bottom of the ring), all the way round
    const a = Math.PI / 2 + (k / STEPS) * 2 * Math.PI;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const prev = pts[k - 1];
    if (prev) d += Math.hypot(x - prev.x, y - prev.y);
    pts.push({ x, y, d });
  }
  const total = d;
  return seats
    .map((p, i) => {
      const want = (((i - mine + n) % n) / n) * total;
      const at = pts.find((q) => q.d >= want) ?? pts[0]!;
      // A wide window has room for bigger houses: the village, not the sky, fills it.
      return { x: at.x, y: at.y, s: 1.28 * (0.62 + (0.38 * (at.y - (cy - ry))) / (2 * ry)), p, seat: i };
    })
    .sort((a, b) => a.y - b.y);
}

function street(seats: Array<PlayerView | null>, mine: number): Spot[] {
  const n = seats.length;
  const front = Math.floor(n / 2);
  const back = n - front;
  // Round the table from the viewer: the viewer sits in the middle of the front row.
  const order = seats.map((_, i) => (mine + i - Math.floor(front / 2) + n) % n);
  const row = (count: number, y: number, s: number, from: number) =>
    Array.from({ length: count }, (_, k) => {
      const seat = order[from + k]!;
      const x = 38 + ((k + 0.5) * (W - 76)) / count;
      return { x, y, s, p: seats[seat] ?? null, seat };
    });
  // The front row runs left to right; the back row continues round the table, right to left.
  return [...row(back, 176, 0.72, front).reverse(), ...row(front, 268, 0.94, 0)].sort((a, b) => a.y - b.y);
}

/** The well: in the middle of the square, or on the street, in the front row's gap nearest the middle. */
function wellSpot(n: number, compact: boolean): { x: number; y: number; s: number } {
  const { cx, cy } = ring(compact);
  // off the middle, so the viewer's own house at the front never stands in front of it
  if (!compact) return { x: cx - 74, y: cy + 4, s: 1.15 };
  const front = Math.max(1, Math.floor(n / 2));
  const step = (W - 76) / front;
  // with an even front row the middle is a gap; with an odd one, the gap beside the middle house
  const x = front % 2 === 0 ? cx : cx + step / 2;
  return { x, y: 262, s: 0.72 };
}

/** Where the drawing sits in its box: the scale, and the offsets of the letterboxing (bottom-aligned). */
function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ k: 1, ox: 0, oy: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? W;
      const h = e?.contentRect.height ?? H;
      const k = Math.min(w / W, h / H);
      setFit({ k, ox: (w - W * k) / 2, oy: h - H * k });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, fit };
}

/** The same house for the same person every game: height and roof from their id. */
function build(id: number) {
  const h = (id * 2654435761) % 997;
  return {
    floors: 2 + (h % 3),
    roof: (["tank", "antenna", "tin", "plants"] as const)[h % 4],
    shade: h % 3,
    wide: h % 5 === 0,
  };
}
const SKIES: Sky[] = ["lobby", "night", "dawn", "day", "dusk"];

export type HouseMark = {
  /** Can be chosen right now. */
  pickable: boolean;
  chosen: boolean;
  /** Votes against this player (a vote or an election), or the pack's picks for the wolves. */
  tally: number;
  wolfPick: number;
  speaking: boolean;
};

export function Village({
  view,
  me,
  marks,
  progress,
  compact,
  onPick,
  onHouse,
  placeholder = 0,
}: {
  /** Empty lots to draw when there is no table yet. */
  placeholder?: number;
  view: TableView | null;
  me: number;
  marks: Map<number, HouseMark>;
  /** How much of this phase has gone, 0 to 1 (null: no clock). */
  progress: number | null;
  compact: boolean;
  onPick: (id: number) => void;
  onHouse: (id: number) => void;
}) {
  const sky = skyOf(view?.phase ?? null);
  const seats = useMemo(() => {
    const players: Array<PlayerView | null> = view ? [...view.players] : Array(placeholder).fill(null);
    // In the lobby, the empty seats show as empty lots.
    if (view?.phase === "lobby") while (players.length < view.settings.seats) players.push(null);
    return players;
  }, [view, placeholder]);
  const mine = Math.max(
    0,
    seats.findIndex((p) => p?.id === me),
  );
  const spots = layout(seats, mine, compact);
  const { cx, cy, rx, ry } = ring(compact);
  const { ref, fit } = useFit();
  const viewerWolf = view?.me?.role === "werewolf" || view?.me?.role === "wolfcub";
  const well = wellSpot(seats.length, compact);

  // Nightfall and daybreak: the lights go out (or come on) one house at a time, round the square.
  const [turning, setTurning] = useState(false);
  const lastSky = useRef(sky);
  useEffect(() => {
    if (lastSky.current === sky) return;
    lastSky.current = sky;
    setTurning(true);
    const t = window.setTimeout(() => setTurning(false), 4000);
    return () => window.clearTimeout(t);
  }, [sky]);

  // A death: the house's light gutters and goes out, a wisp leaves the roof, the window is boarded up.
  const [dying, setDying] = useState<Set<number>>(() => new Set());
  const alive = useRef<Map<number, boolean> | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (!view) return;
    const before = alive.current;
    alive.current = new Map(view.players.map((p) => [p.id, p.alive]));
    if (!before) return;
    const fresh = view.players.filter((p) => !p.alive && before.get(p.id) === true).map((p) => p.id);
    if (!fresh.length) return;
    setDying((d) => new Set([...d, ...fresh]));
    // the next view (which comes often) must not cut the moment short: the timer is only stopped when the village goes
    timers.current.push(
      window.setTimeout(() => setDying((d) => new Set([...d].filter((id) => !fresh.includes(id)))), 3600),
    );
  }, [view]);
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  // the moon or the sun on its arc: left horizon to right
  const t = progress ?? 0.32;
  const ang = Math.PI * (1 - t);
  const orb = { x: W / 2 + 218 * Math.cos(ang), y: cy - ry - 4 - 96 * Math.sin(ang) };

  return (
    <div className={`vl vl-${sky}${compact ? " compact" : ""}`} ref={ref}>
      {/* the five skies, crossfading: the night comes down slowly */}
      {SKIES.map((k) => (
        <div key={k} className={`vl-sky s-${k}${sky === k ? " on" : ""}`} aria-hidden="true" />
      ))}
      <svg viewBox={`0 0 ${W} ${H}`} className="vl-art" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
        <defs>
          <radialGradient id="vl-warm" cx="50%" cy="60%" r="70%">
            <stop offset="0" stopColor="#ffd48a" />
            <stop offset="1" stopColor="#e08a3a" />
          </radialGradient>
          <radialGradient id="vl-pool">
            <stop offset="0" stopColor="#f3b766" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#e89a48" stopOpacity="0.16" />
            <stop offset="1" stopColor="#e89a48" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="vl-halo">
            <stop offset="0" stopColor="#f6e9c8" stopOpacity="0.5" />
            <stop offset="1" stopColor="#f6e9c8" stopOpacity="0" />
          </radialGradient>
        </defs>
        {sky === "night" || sky === "lobby" ? <Stars dim={sky === "lobby"} /> : null}
        {progress !== null || sky === "lobby" ? (
          <g className="vl-orb" style={{ transform: `translate(${orb.x}px, ${orb.y}px)` }}>
            <circle r="26" fill="url(#vl-halo)" />
            {sky === "night" || sky === "lobby" ? (
              <>
                <circle r="9" className="vl-moon" />
                <circle r="9" cx="4" cy="-2" className="vl-moon-shade" />
              </>
            ) : (
              <circle r="10" className="vl-sun" />
            )}
          </g>
        ) : null}
        {/* the far hills (running on past the picture's edges, so a wide window never shows where they end), then
            the square with its well */}
        <path
          d={`M-1600 ${cy - ry - 6} H0 q60 -16 120 -7 t130 -5 t120 9 t110 -7 H2080 V${H + 900} H-1600 z`}
          className="vl-hill"
        />
        <ellipse cx={cx} cy={cy + 2} rx={rx - 30} ry={ry - 18} className="vl-square" />
        {/* the square's stones, laid in rings round the well */}
        <ellipse cx={cx} cy={cy + 2} rx={rx - 30} ry={ry - 18} className="vl-curb" />
        <ellipse cx={cx} cy={cy + 3} rx={(rx - 30) * 0.74} ry={(ry - 18) * 0.7} className="vl-paving" />
        <ellipse cx={cx} cy={cy + 4} rx={(rx - 30) * 0.46} ry={(ry - 18) * 0.42} className="vl-paving" />
        <Well x={well.x} y={well.y} s={well.s} />
        {spots.map((s, i) =>
          s.p ? (
            <House
              key={s.p.id}
              spot={s}
              p={s.p}
              me={me}
              sky={sky}
              viewerWolf={viewerWolf}
              mark={marks.get(s.p.id)}
              dying={dying.has(s.p.id)}
              delay={turning ? ((s.seat - mine + seats.length) % seats.length) * 160 : 0}
              smoke={i}
            />
          ) : (
            <EmptyLot key={`lot${s.seat}`} spot={s} />
          ),
        )}
      </svg>
      {/* the houses as buttons: names under them, and what is happening to each */}
      {spots.map((s) => {
        if (!s.p) return null;
        const p = s.p;
        const m = marks.get(p.id);
        const style = {
          left: `${fit.ox + s.x * fit.k}px`,
          top: `${fit.oy + s.y * fit.k}px`,
          "--k": s.s * fit.k,
          zIndex: Math.round(s.y),
        } as CSSProperties;
        const state = !p.alive ? "dead" : !p.connected ? "away" : "";
        return (
          <button
            key={p.id}
            type="button"
            className={`vh-btn${m?.pickable ? " pickable" : ""}${m?.chosen ? " chosen" : ""}${m?.speaking ? " speaking" : ""}${state ? ` ${state}` : ""}${p.id === me ? " mine" : ""}`}
            style={style}
            onClick={() => (m?.pickable ? onPick(p.id) : onHouse(p.id))}
            aria-pressed={m?.pickable ? Boolean(m.chosen) : undefined}
            aria-label={`${p.name}${p.id === me ? " (you)" : ""}${p.alive ? "" : ", dead"}${p.role ? `, ${ROLE_SHORT[p.role]}` : ""}${m?.tally ? `, ${m.tally} votes` : ""}`}
          >
            <span className="vh-hit" />
            <span className="vh-name">
              {p.sheriff && <Badge />}
              {p.role && <RoleIcon of={p.role} className="vh-name-role" />}
              <span className="vh-nm">{p.id === me ? "you" : p.name}</span>
            </span>
            {p.role && (
              <span className="vh-role">
                <RoleIcon of={p.role} />
                <span className="vh-role-t">{p.turned ? "Cursed → wolf" : ROLE_SHORT[p.role]}</span>
              </span>
            )}
            {m && m.tally > 0 && <span className="vh-tally">{m.tally}</span>}
            {m && m.wolfPick > 0 && (
              <span className="vh-claw" title="the pack's pick">
                {m.wolfPick}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Stars({ dim }: { dim: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 140 }, (_, i) => ({
        x: ((i * 97.3) % (W * 2.4)) - W * 0.7,
        // up past the top of the picture too: a tall window shows more sky, and it has stars in it
        y: ((i * 53.7) % 330) - 210,
        r: i % 9 === 0 ? 1.1 : 0.6,
        d: (i % 7) * 0.6,
      })),
    [],
  );
  return (
    <g className={`vl-stars${dim ? " dim" : ""}`}>
      {stars.map((s, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed field of stars
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          style={{ animationDelay: `${s.d}s` }}
        />
      ))}
    </g>
  );
}

function Well({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g className="vl-well" transform={`translate(${x} ${y}) scale(${s}) translate(${-x} ${-y})`}>
      <ellipse cx={x} cy={y} rx={11} ry={4} className="vl-well-rim" />
      <rect x={x - 11} y={y - 7} width={22} height={7} className="vl-well-wall" />
      <rect x={x - 9} y={y - 22} width={1.5} height={15} />
      <rect x={x + 7.5} y={y - 22} width={1.5} height={15} />
      <path d={`M${x - 13} ${y - 21} L${x} ${y - 28} L${x + 13} ${y - 21} z`} />
    </g>
  );
}

function Badge() {
  return (
    <svg viewBox="0 0 10 10" className="vh-badge" aria-label="sheriff">
      <path d="M5 0.6 6.2 3.6 9.4 3.8 6.9 5.8 7.8 9 5 7.2 2.2 9 3.1 5.8 0.6 3.8 3.8 3.6z" />
    </svg>
  );
}

function EmptyLot({ spot }: { spot: Spot }) {
  const w = 22 * spot.s;
  const h = 34 * spot.s;
  return (
    <rect
      x={spot.x - w / 2}
      y={spot.y - h}
      width={w}
      height={h}
      className="vl-lot"
      strokeDasharray={`${2 * spot.s} ${2 * spot.s}`}
    />
  );
}

function House({
  spot,
  p,
  me,
  sky,
  viewerWolf,
  mark,
  dying,
  delay,
  smoke,
}: {
  spot: Spot;
  p: PlayerView;
  me: number;
  sky: Sky;
  viewerWolf: boolean;
  mark: HouseMark | undefined;
  /** Just died: the moment plays once. */
  dying: boolean;
  /** How long this house waits before its light changes (nightfall goes round the square). */
  delay: number;
  /** Where in the round this house's chimney smoke starts. */
  smoke: number;
}) {
  const b = build(p.id);
  const s = spot.s;
  const w = (b.wide ? 30 : 23) * s;
  const fh = 15 * s;
  const h = b.floors * fh + 8 * s;
  const x = spot.x - w / 2;
  const top = spot.y - h;
  const wolf = p.role === "werewolf" || p.role === "wolfcub";
  // The window: lit when someone is home in the lobby, when they speak, and (at night) only the wolves' eyes, for
  // the wolves.
  const light: "warm" | "eyes" | "pale" | "off" | "mine" =
    !p.alive || !p.connected
      ? "off"
      : mark?.speaking
        ? "warm"
        : sky === "night"
          ? viewerWolf && wolf
            ? "eyes"
            : p.id === me
              ? "mine"
              : "off"
          : sky === "lobby" || sky === "dusk"
            ? "warm"
            : "pale";
  const gw = 11 * s;
  const gh = 9 * s;
  const gx = spot.x - gw / 2;
  const gy = top + 6 * s;
  const lit = light === "warm";
  const wait = { transitionDelay: `${delay}ms` } as CSSProperties;
  // someone is home, keeping a fire: at night and in the evening
  const hearth = p.alive && p.connected && (sky === "night" || sky === "lobby" || sky === "dusk");
  const chimney = { x: x + w * 0.72, y: top - 2.5 * s };
  return (
    <g
      className={`vh${p.alive ? "" : " dead"}${dying ? " dying" : ""}${mark?.speaking ? " speaking" : ""}${mark?.chosen ? " chosen" : ""}`}
    >
      {/* the light of its window on the square */}
      <ellipse
        cx={spot.x}
        cy={spot.y + 4 * s}
        rx={w * 1.5}
        ry={8 * s}
        className={`vh-pool${lit ? " on" : ""}${light === "mine" ? " low" : ""}`}
        style={wait}
      />
      {/* its shadow on the square */}
      <ellipse cx={spot.x} cy={spot.y} rx={w * 0.62} ry={3 * s} className="vh-shadow" />
      {hearth && (
        <g className="vh-smoke" style={{ animationDelay: `${-(smoke * 1.37) % 6}s` } as CSSProperties}>
          {[0, 1, 2].map((k) => (
            <circle
              key={k}
              cx={chimney.x}
              cy={chimney.y}
              r={(1.6 + k * 0.5) * s}
              style={{ animationDelay: `${-((smoke * 1.37 + k * 2) % 6)}s` }}
            />
          ))}
        </g>
      )}
      <rect x={x} y={top} width={w} height={h} className={`vh-body s${b.shade}`} />
      <rect x={x} y={top - 2.5 * s} width={w} height={2.5 * s} className="vh-parapet" />
      <rect x={x} y={top - 2.5 * s} width={w} height={0.7 * s} className="vh-rim" />
      <rect x={x} y={top} width={0.6} height={h} className="vh-edge" />
      {b.roof === "tank" && (
        <rect x={spot.x - 6 * s} y={top - 8.5 * s} width={12 * s} height={5.5 * s} rx={2.7 * s} className="vh-roof" />
      )}
      {b.roof === "antenna" && (
        <path
          d={`M${spot.x} ${top - 2.5 * s} v${-14 * s} M${spot.x - 4 * s} ${top - 13 * s} h${8 * s} M${spot.x - 2.6 * s} ${top - 10 * s} h${5.2 * s}`}
          className="vh-wire"
        />
      )}
      {b.roof === "tin" && (
        <path d={`M${x} ${top - 2.5 * s} v${-6 * s} L${x + w} ${top - 4.5 * s} v${2 * s} z`} className="vh-roof" />
      )}
      {b.roof === "plants" && (
        <path
          d={`M${x + 3 * s} ${top - 2.5 * s} q${1.5 * s} ${-6 * s} ${3 * s} 0 q${1.5 * s} ${-7 * s} ${4 * s} 0`}
          className="vh-leaves"
        />
      )}
      {/* the upper floors' small dark windows, then the player's own window */}
      {Array.from({ length: b.floors - 1 }, (_, f) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: floors never reorder
          key={f}
          x={spot.x - 3 * s}
          y={top + 6 * s + (f + 1) * fh}
          width={6 * s}
          height={5 * s}
          className="vh-small"
        />
      ))}
      {light !== "off" && light !== "pale" && light !== "warm" && (
        <rect x={gx - 4 * s} y={gy - 3 * s} width={gw + 8 * s} height={gh + 6 * s} className={`vh-spill ${light}`} />
      )}
      <rect
        x={gx - 4 * s}
        y={gy - 3 * s}
        width={gw + 8 * s}
        height={gh + 6 * s}
        className={`vh-spill warm${lit ? " on" : ""}`}
        style={wait}
      />
      <rect x={gx} y={gy} width={gw} height={gh} className={`vh-glass ${light === "warm" ? "off" : light}`} />
      {/* the lamp: fades in and out (so nightfall can go round the square), and gutters when someone dies */}
      <rect
        x={gx}
        y={gy}
        width={gw}
        height={gh}
        className={`vh-lamp${lit ? " on" : ""}`}
        style={{ ...wait, animationDelay: `${(p.id % 7) * -0.9}s` }}
      />
      {light === "eyes" && (
        <g className="vh-eyes">
          <rect x={spot.x - 3 * s} y={gy + 3.4 * s} width={2 * s} height={1.4 * s} />
          <rect x={spot.x + 1 * s} y={gy + 3.4 * s} width={2 * s} height={1.4 * s} />
        </g>
      )}
      <rect x={spot.x - 0.4 * s} y={gy} width={0.8 * s} height={gh} className="vh-mullion" />
      {dying && (
        <path
          d={`M${spot.x} ${top - 4 * s} c${-4 * s} ${-5 * s} ${4 * s} ${-9 * s} 0 ${-14 * s} c${-4 * s} ${-5 * s} ${3 * s} ${-9 * s} ${-1 * s} ${-13 * s}`}
          className="vh-wisp"
        />
      )}
      {!p.alive && (
        <g className="vh-planks">
          <path d={`M${gx - 1.5 * s} ${gy + 1 * s} L${gx + gw + 1.5 * s} ${gy + gh - 1 * s}`} />
          <path d={`M${gx - 1.5 * s} ${gy + gh - 1 * s} L${gx + gw + 1.5 * s} ${gy + 1 * s}`} />
        </g>
      )}
      <rect x={spot.x - 3 * s} y={spot.y - 10 * s} width={6 * s} height={10 * s} className="vh-door" />
      {p.lover && (
        <path
          d={`M${spot.x} ${spot.y - 4.2 * s} l${-1.8 * s} ${-1.8 * s} a${s} ${s} 0 0 1 ${1.8 * s} ${-1.1 * s} a${s} ${s} 0 0 1 ${1.8 * s} ${1.1 * s} z`}
          className="vh-heart"
        />
      )}
      {mark?.chosen && (
        <g className="vh-lantern">
          <path d={`M${x + w + 1.5 * s} ${top + 8 * s} h${3 * s} v${2 * s}`} />
          <rect x={x + w + 3 * s} y={top + 10 * s} width={3.2 * s} height={4.2 * s} rx={0.8 * s} />
        </g>
      )}
    </g>
  );
}
