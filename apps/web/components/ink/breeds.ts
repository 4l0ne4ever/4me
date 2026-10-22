// The kinds of cat Ink can be. Each one is drawn from her own frames: markings painted onto her fur (stripes, a
// white shirt, dark points), or her outline changed (fluffed out, rounded). Pure, so every kind can be tested.

import type { Breed } from "@4me/shared";
import type { FrameName } from "./sprites";

export const BREED_INFO: Record<Breed, { label: string; about: string; fur: string; eyes: string }> = {
  shorthair: { label: "Shorthair", about: "plain fur, the one she was drawn as", fur: "#17191f", eyes: "#f6bd63" },
  tabby: { label: "Tabby", about: "stripes, an M on her brow, a ringed tail", fur: "#d07a35", eyes: "#8fd16a" },
  tuxedo: { label: "Tuxedo", about: "white chest, chin and socks", fur: "#17191f", eyes: "#f2df6b" },
  siamese: { label: "Siamese", about: "dark ears, face, paws and tail; talks a lot", fur: "#ece0cb", eyes: "#7ec8f2" },
  longhair: { label: "Longhair", about: "a fluffy coat and a bushy tail", fur: "#eef0f4", eyes: "#e0874a" },
  round: { label: "Round", about: "chubby cheeks, small ears, a quiet voice", fur: "#7d8ea6", eyes: "#e0874a" },
};

type Box = [x0: number, y0: number, x1: number, y1: number];
/** Where her head and her tail are in each frame (the sleeping curl has its tail tucked in). */
const PARTS: Record<FrameName, { head: Box; tail: Box | null }> = {
  walkA: { head: [12, 1, 21, 7], tail: [3, 0, 7, 7] },
  walkB: { head: [12, 1, 21, 7], tail: [3, 0, 7, 7] },
  sit: { head: [8, 1, 17, 7], tail: [1, 11, 6, 14] },
  blink: { head: [8, 1, 17, 7], tail: [1, 11, 6, 14] },
  happy: { head: [8, 1, 17, 7], tail: [1, 11, 6, 14] },
  groom: { head: [8, 1, 19, 8], tail: [1, 11, 6, 14] },
  sleep: { head: [13, 8, 21, 13], tail: null },
  eat: { head: [12, 8, 21, 13], tail: [3, 1, 6, 7] },
  crouch: { head: [12, 8, 21, 13], tail: [3, 1, 6, 7] },
};

const FUR = new Set(["k", "s", "r"]);
const inBox = (b: Box | null, x: number, y: number) => b !== null && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/**
 * A frame as a kind of cat. New letters: `d` stripe, `W` white, `q` dark point, `F` fluff. The palette for them
 * comes from `breedColours`.
 */
export function breedFrame(breed: Breed, frame: FrameName, rows: readonly string[]): string[] {
  if (breed === "shorthair") return [...rows];
  const g = rows.map((r) => r.split(""));
  const H = g.length;
  const W = g[0]?.length ?? 0;
  const at = (x: number, y: number) => g[y]?.[x] ?? ".";
  const set = (x: number, y: number, ch: string) => {
    if (y >= 0 && y < H && x >= 0 && x < W) g[y]![x] = ch;
  };
  const { head, tail } = PARTS[frame];
  // Her feet: the lowest two rows anything is drawn on.
  const drawn = g.map((r, y) => (r.some((c) => c !== ".") ? y : -1)).filter((y) => y >= 0);
  const floor = drawn.at(-1) ?? H - 1;
  const isPaw = (x: number, y: number) => y >= floor - 1 && !inBox(tail, x, y) && !inBox(head, x, y);
  // The row of her eyes (open, closed or happy), so the face can be told from the brow.
  const eyesRow = g.findIndex(
    (r, y) => y >= head[1] && y <= head[3] && r.some((c, x) => x >= head[0] && "eEc".includes(c)),
  );
  const eyes = eyesRow >= 0 ? eyesRow : head[1] + 4;
  const each = (f: (x: number, y: number, c: string) => void) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f(x, y, at(x, y));
  };

  if (breed === "tabby") {
    each((x, y, c) => {
      if (c !== "k") return;
      if (inBox(tail, x, y)) return void (y % 2 === 0 && set(x, y, "d"));
      if (inBox(head, x, y)) {
        // an M on the brow, above the eyes
        if (y === eyes - 2 && (x - head[0]) % 2 === 1) set(x, y, "d");
        return;
      }
      if (!isPaw(x, y) && x % 3 === 0) set(x, y, "d");
    });
  }

  if (breed === "tuxedo") {
    each((x, y, c) => {
      if (!FUR.has(c)) return;
      const chest = x >= head[0] + 1 && x <= head[2] - 1 && y > head[3] && y <= head[3] + 2;
      const chin = inBox(head, x, y) && y === head[3] && c === "k";
      if (isPaw(x, y) || chest || chin) set(x, y, "W");
    });
  }

  if (breed === "siamese") {
    // The mask runs from just outside her eyes in to her nose; her cheeks stay pale.
    const eyeCols = (g[eyes] ?? []).flatMap((c, x) => ("eEc".includes(c) && x >= head[0] ? [x] : []));
    const left = (eyeCols[0] ?? head[0] + 2) - 1;
    const right = (eyeCols.at(-1) ?? head[2] - 2) + 1;
    each((x, y, c) => {
      if (!FUR.has(c)) return;
      const ears = inBox(head, x, y) && y <= head[1] + 1;
      const face = inBox(head, x, y) && y >= eyes - 1 && x >= left && x <= right;
      if (ears || face || isPaw(x, y) || inBox(tail, x, y)) set(x, y, "q");
    });
  }

  if (breed === "longhair") {
    // Fluff all round her body and tail, but not on her ears, her face or her feet.
    const add: Array<[number, number]> = [];
    each((x, y, c) => {
      if (c !== ".") return;
      const near = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => FUR.has(at(nx!, ny!)) && !(inBox(head, nx!, ny!) && ny! < eyes));
      if (!near || y >= floor - 1) return;
      if (inBox(head, x, y) && y < eyes) return;
      add.push([x, y]);
    });
    for (const [x, y] of add) set(x, y, "F");
  }

  if (breed === "round") {
    // Wider through the body and the cheeks; ears without their tips.
    const add: Array<[number, number]> = [];
    each((x, y, c) => {
      if (c !== "." || y >= floor - 1 || inBox(tail, x, y)) return;
      const side = FUR.has(at(x - 1, y)) || FUR.has(at(x + 1, y));
      const cheeks = inBox(head, x, y) || inBox(head, x - 1, y) || inBox(head, x + 1, y);
      if (side && (!cheeks || (y >= eyes && y <= head[3]))) add.push([x, y]);
    });
    for (const [x, y] of add) set(x, y, "k");
    for (let x = head[0]; x <= head[2]; x++) if (at(x, head[1]) === "r") set(x, head[1], ".");
  }

  return g.map((r) => r.join(""));
}
