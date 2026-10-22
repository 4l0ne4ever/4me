// How Ink looks: her colours, the collar with her name tag, and a hat for the season. Pure, so it is easy to test.

import { type InkLook, inkLook, type Outfit } from "@4me/shared";
import { type FrameName, PALETTE } from "./sprites";

export const DEFAULT_LOOK: InkLook = {
  name: "Ink",
  fur: "#17191f",
  eyes: "#f6bd63",
  collar: "#c8333b",
  outfit: "season",
};

/** The colours offered first. Any colour can be picked too; these are the ones that look like real cats. */
export const FURS = [
  { id: "#17191f", label: "Ink black" },
  { id: "#5b616e", label: "Smoke" },
  { id: "#7d8ea6", label: "Blue" },
  { id: "#6b4a3a", label: "Cocoa" },
  { id: "#d07a35", label: "Ginger" },
  { id: "#e9d3a8", label: "Cream" },
  { id: "#eef0f4", label: "Snow" },
];
export const EYES = [
  { id: "#f6bd63", label: "Amber" },
  { id: "#f2df6b", label: "Gold" },
  { id: "#8fd16a", label: "Green" },
  { id: "#7ec8f2", label: "Blue" },
  { id: "#e0874a", label: "Copper" },
];
export const COLLARS = [
  { id: "#c8333b", label: "Red" },
  { id: "#ef7fa8", label: "Pink" },
  { id: "#f2c94c", label: "Yellow" },
  { id: "#2f9c95", label: "Teal" },
  { id: "#33478a", label: "Navy" },
];

export const OUTFIT_NAMES: Record<Outfit, string> = {
  witch: "Witch hat",
  santa: "Santa hat",
  mai: "Apricot blossom",
  beanie: "Wool beanie",
  flowers: "Flower crown",
  straw: "Straw hat",
  leaf: "Fallen leaf",
};

/* ---------- colours ---------- */

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** `a` moved `t` of the way towards `b`. */
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + ((y[i] ?? 0) - v) * t));
};
/** How light a colour looks, 0 (black) to 1 (white). */
export const lightness = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/**
 * Her palette for a look. The shadow, the rim light along her back, the whiskers and the closed eyes all follow the
 * fur, so a ginger or a white cat is shaded as carefully as the black one she was drawn as.
 */
export function paletteFor(look: InkLook): Record<string, string> {
  const p: Record<string, string> = {
    ...PALETTE,
    l: look.collar,
    g: lightness(look.collar) > 0.6 ? "#d9dde6" : "#f2c94c",
  };
  if (look.fur !== DEFAULT_LOOK.fur) {
    const light = lightness(look.fur);
    p.k = look.fur;
    p.s = mix(look.fur, "#000000", light > 0.6 ? 0.22 : 0.45);
    p.r = light < 0.3 ? mix(look.fur, "#9fb0cc", 0.42) : mix(look.fur, "#ffffff", 0.4);
    if (light > 0.35) {
      p.c = mix(look.fur, "#000000", 0.55);
      p.w = mix(look.fur, "#000000", 0.35);
      p.i = "#e8a3b0";
    }
  }
  if (look.eyes !== DEFAULT_LOOK.eyes) {
    p.e = look.eyes;
    p.E = mix(look.eyes, "#000000", 0.22);
  }
  return p;
}

/** A saved look, or the default one if it is missing or broken. */
export function loadLook(raw: unknown): InkLook {
  const v = inkLook.safeParse(raw);
  return v.success ? v.data : DEFAULT_LOOK;
}

/* ---------- the collar and its name tag ---------- */

type Spot = [x: number, y: number, ch: "l" | "g"];
const row = (from: number, to: number, y: number): Spot[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, y, "l"] as Spot);
const col = (x: number, from: number, to: number): Spot[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [x, from + i, "l"] as Spot);

const COLLAR: Record<FrameName, Spot[]> = {
  walkA: [...row(13, 18, 8), [16, 9, "g"]],
  walkB: [...row(13, 18, 8), [16, 9, "g"]],
  sit: [...row(9, 15, 8), [12, 9, "g"]],
  blink: [...row(9, 15, 8), [12, 9, "g"]],
  happy: [...row(9, 15, 8), [12, 9, "g"]],
  groom: [...row(9, 15, 8), [12, 9, "g"]],
  sleep: [...col(13, 11, 13), [13, 14, "g"]],
  eat: [...col(13, 10, 12), [13, 13, "g"]],
  crouch: [...col(13, 10, 12), [13, 13, "g"]],
};

/** A frame with her collar and tag painted on. */
export function withCollar(frame: FrameName, rows: readonly string[]): string[] {
  const out = rows.map((r) => r.split(""));
  for (const [x, y, ch] of COLLAR[frame]) {
    const line = out[y];
    if (line?.[x] && line[x] !== ".") line[x] = ch;
  }
  return out.map((r) => r.join(""));
}

/* ---------- hats ---------- */

export const HAT_PALETTE: Record<string, string> = {
  p: "#4a2b6e",
  P: "#7a4fb0",
  o: "#f08a24",
  R: "#c8333b",
  W: "#f4f1ea",
  v: "#3f6fa8",
  V: "#6f9bd1",
  F: "#f49ac1",
  G: "#6aa86a",
  M: "#f6c945",
  O: "#e07a1f",
  t: "#e3c27a",
  T: "#b8893f",
  a: "#e0782c",
  A: "#a9471c",
};

/** Each hat, bottom row resting on the top of her head, and where it sits: between the ears, or on the right one. */
const HATS: Record<Outfit, { rows: string[]; at: "middle" | "ear" }> = {
  witch: { rows: [".....pp.", "....pPp.", "...pPpp.", "..pPppp.", "..ooooo.", "pppppppp"], at: "middle" },
  santa: { rows: [".....WW", "...RRRW", "..RRRR.", ".RRRRR.", "WWWWWWW"], at: "middle" },
  beanie: { rows: ["...W...", ".vVvVv.", "vVvVvVv", "VVVVVVV"], at: "middle" },
  flowers: { rows: [".F.M.F.", "FGMGFGM"], at: "middle" },
  straw: { rows: ["..tttt..", "..TRRT..", "tttttttt"], at: "middle" },
  leaf: { rows: ["..a.", ".aaa", "aAa.", ".A.."], at: "middle" },
  mai: { rows: [".M.", "MOM", ".M."], at: "ear" },
};

/** Where her head is in each frame: the middle between her ears, the row of the ear tips, and the right ear. */
const HEAD: Record<FrameName, { cx: number; ear: number; right: number }> = {
  walkA: { cx: 15.5, ear: 1, right: 18 },
  walkB: { cx: 15.5, ear: 1, right: 18 },
  sit: { cx: 11.5, ear: 1, right: 14 },
  blink: { cx: 11.5, ear: 1, right: 14 },
  happy: { cx: 11.5, ear: 1, right: 14 },
  groom: { cx: 11.5, ear: 1, right: 14 },
  sleep: { cx: 16, ear: 8, right: 18 },
  eat: { cx: 16, ear: 8, right: 18 },
  crouch: { cx: 16, ear: 8, right: 18 },
};

/** Rows of room above the frame for a tall hat. */
export const HAT_ROOM = 5;

/** The hat for a frame, in a canvas HAT_ROOM rows taller than the frame: its rows and top-left corner. */
export function hatFor(outfit: Outfit, frame: FrameName): { rows: string[]; x: number; y: number } {
  const hat = HATS[outfit];
  const head = HEAD[frame];
  const w = hat.rows[0]?.length ?? 0;
  const h = hat.rows.length;
  if (hat.at === "ear") return { rows: hat.rows, x: head.right - 1, y: head.ear - 1 + HAT_ROOM };
  return { rows: hat.rows, x: Math.round(head.cx - w / 2), y: head.ear + 2 - h + HAT_ROOM };
}

/* ---------- the seasons ---------- */

/** Tết, the first day of the lunar year, for the years this site is likely to see. */
const TET = ["2025-01-29", "2026-02-17", "2027-02-06", "2028-01-26", "2029-02-13", "2030-02-03", "2031-01-23"];
const DAY = 86_400_000;

/** What Ink wears on a day in Vietnam: a hat for the festival if there is one, otherwise one for the season. */
export function seasonalOutfit(now: Date): Outfit {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
    .format(now)
    .split("-")
    .map(Number) as [number, number, number];
  const today = Date.UTC(y, m - 1, d);
  if (TET.some((t) => today >= Date.parse(t) - 10 * DAY && today <= Date.parse(t) + 7 * DAY)) return "mai";
  if ((m === 10 && d >= 20) || (m === 11 && d === 1)) return "witch";
  if (m === 12 && d >= 18 && d <= 26) return "santa";
  if (m === 12 || m <= 2) return "beanie";
  if (m <= 5) return "flowers";
  if (m <= 8) return "straw";
  return "leaf";
}

/** The hat she actually wears today for a look, or null for none. */
export const outfitToday = (look: InkLook, now: Date): Outfit | null =>
  look.outfit === "none" ? null : look.outfit === "season" ? seasonalOutfit(now) : look.outfit;
