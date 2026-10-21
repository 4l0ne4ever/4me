// Where Ink can stand: the taskbar, the top edge of every open window, and the roofs of the houses across the street.
// Heights are measured up from the taskbar, like her own `y`.

/** A surface: its span across the screen, its height, and (for a window) the height of its lower edge. */
export type Plat = { id: string; left: number; right: number; y: number; bottom?: number };
export const GROUND = "ground";

/** One leg of a trip: walk along the surface she is on, hop down off it, or climb a wall up onto a surface. */
export type Step =
  | { kind: "walk"; x: number }
  | { kind: "drop" }
  | { kind: "climb"; id: string; side: "left" | "right" };

/** How far from a wall her box sits while she climbs it (the sprite turns upright, so it is narrower than wide). */
export const CLIMB_INSET = { left: 55, right: 10 };

export const groundOf = (width: number): Plat => ({ id: GROUND, left: 0, right: width, y: 0 });

/** The surfaces on screen now. Narrow screens stack their windows, so there she keeps to the taskbar. */
export function readPlatforms(catW: number): Plat[] {
  if (typeof document === "undefined" || window.innerWidth < 900) return [];
  const taskTop = document.querySelector(".task")?.getBoundingClientRect().top ?? window.innerHeight - 48;
  const out: Plat[] = [];
  document.querySelectorAll<HTMLElement>(".desk .win").forEach((el, i) => {
    const r = el.getBoundingClientRect();
    // Room to stand: wide enough, and low enough that most of her shows above it (her ears may tuck off-screen).
    if (r.width < catW + 24 || r.top < 28 || r.top > taskTop - 70) return;
    out.push({
      id: `win:${el.id || i}`,
      left: r.left,
      right: r.right,
      y: taskTop - r.top,
      bottom: Math.max(0, taskTop - r.bottom),
    });
  });
  document.querySelectorAll<SVGElement>(".skyline [data-roof]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 4) return;
    out.push({ id: `roof:${el.dataset.roof}`, left: r.left, right: r.right, y: taskTop - r.top });
  });
  return out;
}

export const findPlat = (plats: Plat[], id: string, width: number): Plat | null =>
  id === GROUND ? groundOf(width) : (plats.find((p) => p.id === id) ?? null);

/** The surface something falling from height `from` to `to` meets first, under the point `cx` (or none yet). */
export function landing(plats: Plat[], cx: number, from: number, to: number, width: number): Plat | null {
  let best: Plat | null = null;
  for (const p of [...plats, groundOf(width)]) {
    if (cx < p.left || cx > p.right || p.y > from + 0.5 || p.y < to) continue;
    if (!best || p.y > best.y) best = p;
  }
  return best;
}

/**
 * The way from where she is to a spot on a surface: along her surface to its nearer edge and down, along the
 * taskbar to the nearer wall of the target, up it, and along to the spot.
 */
export function plan(
  from: { on: string; x: number },
  goal: { on: string; x: number },
  plats: Plat[],
  width: number,
  catW: number,
): Step[] {
  const steps: Step[] = [];
  let at = from.x;
  if (from.on !== goal.on) {
    const here = from.on === GROUND ? null : findPlat(plats, from.on, width);
    if (here) {
      const leftEdge = here.left - catW / 2;
      const rightEdge = here.right - catW / 2;
      at = Math.abs(at - leftEdge) <= Math.abs(at - rightEdge) ? leftEdge : rightEdge;
      steps.push({ kind: "walk", x: at }, { kind: "drop" });
    } else if (from.on !== GROUND) steps.push({ kind: "drop" });
    if (goal.on !== GROUND) {
      const there = findPlat(plats, goal.on, width);
      if (!there) return [...steps, { kind: "walk", x: goal.x }];
      let side: "left" | "right" = at + catW / 2 < (there.left + there.right) / 2 ? "left" : "right";
      const x = (s: "left" | "right") =>
        s === "left" ? there.left - CLIMB_INSET.left : there.right - CLIMB_INSET.right;
      // A wall against the edge of the screen can't be climbed from outside it.
      if (x(side) < 0 || x(side) > width - catW) side = side === "left" ? "right" : "left";
      steps.push({ kind: "walk", x: x(side) }, { kind: "climb", id: there.id, side });
    }
  }
  steps.push({ kind: "walk", x: goal.x });
  return steps;
}
