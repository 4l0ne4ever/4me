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
  compact ? { cx: 240, cy: 200, rx: 186, ry: 62 } : { cx: 240, cy: 196, rx: 206, ry: 68 };

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
  // the back row stands behind the square, against the sky, so its names don't fall on the front row's roofs
  const big = n > 12 ? 0.85 : 1;
  return [...row(back, 150, 1 * big, front).reverse(), ...row(front, 268, 1.2 * big, 0)].sort((a, b) => a.y - b.y);
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
  return { x, y: 262, s: 0.95 };
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

/**
 * The same house for the same person every game, drawn from their id: a cottage in an old village, the kind the
 * werewolf story is told in. A steep gable roof of tiles, slate or thatch with a stone chimney; plaster walls framed
 * in dark timber, or stone; an arched wooden door, small paned windows with boxes of flowers; and, up in the gable
 * under the roof, the player's own window.
 *
 * By day the plaster and the roofs show as they are; dawn warms them, dusk cools them, and at night only enough of
 * them is left for the moon to find.
 */
const PLASTER = ["#f1e4c6", "#ead2a6", "#f3e9dc", "#e7c7a6", "#dfe3d0", "#ecd0c4", "#d9e2e6", "#f0dca0"];
const STONE = ["#cfc8b8", "#bdb7ab", "#d6cbb3"];
const ROOFS = ["#b4553a", "#9c4a36", "#5b6b82", "#c9a35a", "#b4553a", "#7d5560"];
const DOORS = ["#7a4a2a", "#3f5f7a", "#6a2f2f", "#476b3c", "#8a5a2e"];
const FLOWERS = ["#e0574a", "#f0b84a", "#d76fa3", "#f3f0e6"];

function hash(id: number, salt: number): number {
  let x = Math.imul(id ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function build(id: number) {
  const r = (salt: number, n: number) => hash(id, salt) % n;
  const stone = r(1, 3) === 0;
  const roof = ROOFS[r(4, ROOFS.length)]!;
  return {
    storeys: [1, 1, 2, 2, 2, 3][r(2, 6)]!,
    wide: r(3, 4) === 0,
    stone,
    wall: stone ? STONE[r(5, STONE.length)]! : PLASTER[r(5, PLASTER.length)]!,
    roof,
    thatch: roof === "#c9a35a",
    door: DOORS[r(6, DOORS.length)]!,
    /** the door, off to one side or in the middle */
    doorAt: [-1, 0, 1][r(7, 3)]!,
    flowers: FLOWERS[r(8, FLOWERS.length)]!,
    /** which storeys have window boxes (a bit for each) */
    boxes: r(9, 8),
    chimneyLeft: r(10, 2) === 0,
  };
}

/** The far ridge: a line of small trees along the hill behind the village. */
function ridge(base: number): string {
  let d = `M-1600 ${base + 8} H-40`;
  for (let x = -40; x < 540; x += 9) {
    const r = 3 + ((x * 37) % 5) * 0.7;
    d += ` L${x} ${base + 2} a${r} ${r} 0 0 1 ${9} 0`;
  }
  return `${d} L2080 ${base + 8} V${H + 900} H-1600 z`;
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
  // (it starts a little above the ridge, so no house's chimney hides it; a wide window has more sky to climb)
  const orb = { x: W / 2 + 218 * Math.cos(ang), y: cy - ry - 18 - (compact ? 96 : 150) * Math.sin(ang) };

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
        {/* a few clouds by day, drifting */}
        <g className="vl-clouds">
          <path d="M-20 54h46v-6h10v-6h22v6h12v6h30v6H-20z" className="vl-cloud c1" />
          <path d="M300 30h34v-5h12v-6h18v6h10v5h26v5H300z" className="vl-cloud c2" />
          <path d="M150 78h22v-4h10v-5h14v5h8v4h18v4h-72z" className="vl-cloud c3" />
          {/* higher up, for a tall window's sky */}
          <path d="M60 -48h40v-6h14v-6h20v6h10v6h34v6H60z" className="vl-cloud c2" />
          <path d="M340 -112h28v-5h12v-5h16v5h8v5h22v5h-86z" className="vl-cloud c3" />
        </g>
        {/* the hills: a far ridge of trees, then the near hill (both running on past the picture's edges, so a wide
            window never shows where they end), then the square with its well */}
        <path d={ridge(cy - ry - 22)} className="vl-far" />
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
            className={`vh-btn${m?.pickable ? " pickable" : ""}${m?.chosen ? " chosen" : ""}${m?.speaking ? " speaking" : ""}${state ? ` ${state}` : ""}${p.id === me ? " mine" : ""}${p.bot ? " bot" : ""}`}
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
  // Drawn in the house's own units, its foot at the middle of its front; the group places and scales it.
  const half = b.wide ? 15 : 12;
  const S = 12; // a storey
  const wallH = b.storeys * S;
  const ih = half * 1.5; // the gable's height: a steep roof
  const T = 7.5; // the roof's thickness, seen from the front
  /** The height of a point on the roof's slope (off: how far above the gable's edge). */
  const slope = (x: number, off: number) => -wallH - (ih * (1 - Math.abs(x) / half) + off);
  const apex = slope(0, T);
  const eave = slope(half + 3, T);
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
  // the player's own window, up in the gable under the roof
  const gw = b.wide ? 8 : 7;
  const gh = 6.5;
  const gx = -gw / 2;
  const gy = -wallH - ih * 0.45;
  const lit = light === "warm";
  const wait = { transitionDelay: `${delay}ms` } as CSSProperties;
  // someone is home, keeping a fire: at night and in the evening
  const hearth = p.alive && p.connected && (sky === "night" || sky === "lobby" || sky === "dusk");
  const cx = (b.chimneyLeft ? -1 : 1) * half * 0.5;
  const chimneyTop = slope(cx, T) - 7;
  const tinted = (paint: string) => ({ "--paint": paint }) as CSSProperties;
  // the door and the windows beside it, then two windows on each storey above
  const door = { x: b.doorAt * half * 0.5 - 2.5, w: 5, h: 8.5 };
  const windows: Array<{ x: number; y: number; k: number }> = [];
  const ground = b.doorAt === 0 ? [-half * 0.6, half * 0.6] : [-b.doorAt * half * 0.42];
  for (const x of ground) windows.push({ x, y: -S + 3, k: 0 });
  for (let k = 1; k < b.storeys; k++)
    for (const x of [-half * 0.42, half * 0.42]) windows.push({ x, y: -(k + 1) * S + 3, k });
  const ww = 4.6;
  const wh = 5;
  const collar = { y: -wallH - ih * 0.72, hw: half * 0.28 };
  return (
    <g
      className={`vh${p.alive ? "" : " dead"}${dying ? " dying" : ""}${mark?.speaking ? " speaking" : ""}${mark?.chosen ? " chosen" : ""}`}
      transform={`translate(${spot.x} ${spot.y}) scale(${spot.s})`}
    >
      {/* the light of its window on the square, and its shadow */}
      <ellipse
        cx={0}
        cy={4}
        rx={half * 3}
        ry={8}
        className={`vh-pool${lit ? " on" : ""}${light === "mine" ? " low" : ""}`}
        style={wait}
      />
      <ellipse cx={0} cy={0} rx={half * 1.3} ry={3} className="vh-shadow" />
      {hearth && (
        <g className="vh-smoke" style={{ animationDelay: `${-(smoke * 1.37) % 6}s` } as CSSProperties}>
          {[0, 1, 2].map((k) => (
            <circle
              key={k}
              cx={cx}
              cy={chimneyTop - 1}
              r={1.6 + k * 0.5}
              style={{ animationDelay: `${-((smoke * 1.37 + k * 2) % 6)}s` }}
            />
          ))}
        </g>
      )}

      {/* the chimney, then the roof in front of its foot */}
      <rect x={cx - 2.2} y={chimneyTop} width={4.4} height={slope(cx, T) - chimneyTop + 2} className="vh-chimney" />
      <rect x={cx - 2.8} y={chimneyTop - 1.2} width={5.6} height={1.6} className="vh-timber" />
      <path
        d={`M${-half - 3} ${eave} L0 ${apex} L${half + 3} ${eave} z`}
        className={`vh-tinted vh-roofing${b.thatch ? " thatch" : ""}`}
        style={tinted(b.roof)}
      />
      {[0.3, 0.62].map((at) => (
        <path
          key={at}
          d={`M${-half - 2.4} ${slope(half + 2.4, T * at)} L0 ${slope(0, T * at)} L${half + 2.4} ${slope(half + 2.4, T * at)}`}
          className={`vh-roof-tex${b.thatch ? " thatch" : ""}`}
        />
      ))}
      <rect x={-1} y={apex - 1.6} width={2} height={2} className="vh-timber" />

      {/* the walls and the gable */}
      <path
        d={`M${-half} 0 V${-wallH} L0 ${-wallH - ih} L${half} ${-wallH} V0 z`}
        className="vh-body"
        style={tinted(b.wall)}
      />
      {b.stone ? (
        // stone: the blocks at the corners, and a few joints
        <>
          {Array.from({ length: Math.floor(wallH / 3) }, (_, i) => {
            const y = -3 * (i + 1);
            const wide = i % 2 === 0 ? 3 : 2;
            return (
              <g key={y}>
                <rect x={-half} y={y} width={wide} height={2.6} className="vh-quoin" />
                <rect x={half - wide} y={y} width={wide} height={2.6} className="vh-quoin" />
              </g>
            );
          })}
          <path
            d={`M${-half + 4} ${-wallH * 0.3} h4 M${half - 9} ${-wallH * 0.55} h3.5 M${-half + 6} ${-wallH * 0.75} h3 M2 -3 h4`}
            className="vh-joint"
          />
        </>
      ) : (
        // plaster in a timber frame, on a stone footing
        <>
          <rect x={-half} y={-3} width={half * 2} height={3} className="vh-plinth" />
          <rect x={-half} y={-wallH} width={1.3} height={wallH - 3} className="vh-timber" />
          <rect x={half - 1.3} y={-wallH} width={1.3} height={wallH - 3} className="vh-timber" />
          {Array.from({ length: b.storeys }, (_, k) => {
            const y = -(k + 1) * S;
            return (
              <g key={y}>
                <rect x={-half} y={y - 0.6} width={half * 2} height={1.3} className="vh-timber" />
                {k > 0 && (
                  <path
                    d={`M${-half + 1.3} ${y + 1.3} L${-half + 4.6} ${y + S - 0.6} M${half - 1.3} ${y + 1.3} L${half - 4.6} ${y + S - 0.6}`}
                    className="vh-brace"
                  />
                )}
              </g>
            );
          })}
          <rect x={-collar.hw} y={collar.y - 0.6} width={collar.hw * 2} height={1.2} className="vh-timber" />
          <path
            d={`M${gx - 1.8} ${-wallH} L${-collar.hw + 0.4} ${collar.y} M${-gx + 1.8} ${-wallH} L${collar.hw - 0.4} ${collar.y}`}
            className="vh-brace"
          />
        </>
      )}
      {/* the shade under the roof's edge, and on the side away from the light */}
      <path d={`M${-half} ${-wallH + 0.4} L0 ${-wallH - ih + 0.6} L${half} ${-wallH + 0.4}`} className="vh-eave" />
      <path d={`M${half} 0 V${-wallH} L${half * 0.82} ${-wallH - ih * 0.18} V0 z`} className="vh-side" />

      {/* the windows: small panes, and a box of flowers under some */}
      {windows.map((wi) => (
        <g key={`${wi.x} ${wi.y}`}>
          <rect x={wi.x - ww / 2 - 0.6} y={wi.y - 0.6} width={ww + 1.2} height={wh + 1.2} className="vh-timber" />
          <rect x={wi.x - ww / 2} y={wi.y} width={ww} height={wh} className="vh-small" />
          <path d={`M${wi.x} ${wi.y} v${wh} M${wi.x - ww / 2} ${wi.y + wh / 2} h${ww}`} className="vh-pane" />
          {(b.boxes >> wi.k) & 1 ? (
            <>
              <rect x={wi.x - ww / 2 - 0.8} y={wi.y + wh + 0.4} width={ww + 1.6} height={1.5} className="vh-timber" />
              {[-1.6, 0, 1.6].map((dx) => (
                <circle
                  key={dx}
                  cx={wi.x + dx}
                  cy={wi.y + wh + 0.1}
                  r={0.85}
                  className="vh-tinted"
                  style={tinted(b.flowers)}
                />
              ))}
            </>
          ) : null}
        </g>
      ))}

      {/* the door: arched, of planks */}
      <rect x={door.x - 0.8} y={-0.8} width={door.w + 1.6} height={0.8} className="vh-plinth" />
      <path d={`M${door.x} 0 V${-door.h + 2.5} a2.5 2.5 0 0 1 5 0 V0 z`} className="vh-tinted" style={tinted(b.door)} />
      <path d={`M${door.x + 1.7} 0 V${-door.h + 1} M${door.x + 3.3} 0 V${-door.h + 1}`} className="vh-plank" />
      <circle cx={door.x + 4} cy={-4} r={0.45} className="vh-knob" />
      {p.lover && (
        <path
          d={`M${door.x + 2.5} -3.2 l-1.5 -1.5 a0.85 0.85 0 0 1 1.5 -0.9 a0.85 0.85 0 0 1 1.5 0.9 z`}
          className="vh-heart"
        />
      )}

      {/* the player's own window, up in the gable */}
      {light !== "off" && light !== "pale" && light !== "warm" && (
        <rect x={gx - 4} y={gy - 3} width={gw + 8} height={gh + 6} className={`vh-spill ${light}`} />
      )}
      <rect
        x={gx - 4}
        y={gy - 3}
        width={gw + 8}
        height={gh + 6}
        className={`vh-spill warm${lit ? " on" : ""}`}
        style={wait}
      />
      <rect x={gx - 0.7} y={gy - 0.7} width={gw + 1.4} height={gh + 1.4} className="vh-timber" />
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
          <rect x={-2.6} y={gy + 2.6} width={1.8} height={1.3} />
          <rect x={0.8} y={gy + 2.6} width={1.8} height={1.3} />
        </g>
      )}
      <path d={`M0 ${gy} v${gh} M${gx} ${gy + gh / 2} h${gw}`} className="vh-mullion" />
      <rect x={gx - 1.2} y={gy + gh + 0.3} width={gw + 2.4} height={1.1} className="vh-timber" />
      {!p.alive && (
        <g className="vh-planks">
          <path d={`M${gx - 1.5} ${gy + 0.8} L${gx + gw + 1.5} ${gy + gh - 0.8}`} />
          <path d={`M${gx - 1.5} ${gy + gh - 0.8} L${gx + gw + 1.5} ${gy + 0.8}`} />
        </g>
      )}

      {dying && <path d={`M${cx} ${chimneyTop - 2} c-4 -5 4 -9 0 -14 c-4 -5 3 -9 -1 -13`} className="vh-wisp" />}
      {mark?.chosen && (
        <g className="vh-lantern">
          <path d={`M${half + 2} ${eave + 1} v2.6`} />
          <rect x={half + 0.7} y={eave + 3.4} width={2.6} height={3.4} rx={0.7} />
        </g>
      )}
    </g>
  );
}
