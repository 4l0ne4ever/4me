// Ink's pixel art. Every frame is a map of palette characters, 22 x 15, facing right.
// "." is transparent. Edit a frame by editing the letters; the renderer draws one square per letter.

export const PALETTE: Record<string, string> = {
  k: "#17191f", // fur
  s: "#0c0d10", // fur in shadow
  r: "#566175", // rim light along the top edges
  e: "#f6bd63", // eye
  E: "#c98a3c", // lower eye
  c: "#7a8397", // closed eye
  n: "#e08f9b", // nose
  i: "#6b4250", // inner ear
  w: "#98a1b2", // whisker
  h: "#e7798f", // blush
  b: "#8e3a33", // bowl
  B: "#c45a4b", // bowl rim
  f: "#9fd0ff", // fish
  y: "#c4544a", // yarn
  Y: "#ee9a86", // yarn highlight
  l: "#c8333b", // collar
  g: "#f2c94c", // name tag
};

export const W = 22;
export const H = 15;

const walkA = [
  "......................",
  ".....r.......r....r...",
  ".....k.......ki..ik...",
  "....k.......kkrrkkkk..",
  "....k.......kkkkkkkkk.",
  "....k.......kkekkkekk.",
  ".....k......kkEkkkEkkw",
  ".....k......kkkkkkknkw",
  "......kkrrkkkkkkkkkk..",
  ".....kkkkkkkkkkkkkkk..",
  ".....kkkkkkkkkkkkkkk..",
  "......sssssssssssss...",
  "......kk.....kk.......",
  "......kk.....kk.......",
  "......................",
];

const walkB = [
  "......................",
  "......r......r....r...",
  ".....k.......ki..ik...",
  "....k.......kkrrkkkk..",
  "....k.......kkkkkkkkk.",
  "....k.......kkekkkekk.",
  ".....k......kkEkkkEkkw",
  ".....k......kkkkkkknkw",
  "......kkrrkkkkkkkkkk..",
  ".....kkkkkkkkkkkkkkk..",
  ".....kkkkkkkkkkkkkkk..",
  "......sssssssssssss...",
  "........kk.kk.........",
  "........kk.kk.........",
  "......................",
];

const sit = [
  "......................",
  ".........r....r.......",
  ".........ki..ik.......",
  "........kkrrkkkk......",
  "........kkkkkkkkk.....",
  "........kkekkkekk.....",
  "........kkEkkkEkkw....",
  "........kkkkkkknkw....",
  ".........kkkkkkk......",
  "........kkkkkkkkk.....",
  ".......kkkkkkkkkkk....",
  ".......kkkkkkkkkkk....",
  "..k....kkkkkkkkkkk....",
  "..kkkkkkkkkkkkkkkk....",
  "........ssskk.kks.....",
];

const blink = sit.map((row, y) => (y === 5 ? row.replace(/e/g, "k") : y === 6 ? row.replace(/E/g, "c") : row));

const happy = [
  "......................",
  ".........r....r.......",
  ".........ki..ik.......",
  "........kkrrkkkk......",
  "........kkkkkkkkk.....",
  "........kkckkkckk.....",
  "........kckckckckw....",
  "........khkkkkhnkw....",
  ".........kkkkkkk......",
  "........kkkkkkkkk.....",
  ".......kkkkkkkkkkk....",
  ".......kkkkkkkkkkk....",
  "..k....kkkkkkkkkkk....",
  "..kkkkkkkkkkkkkkkk....",
  "........ssskk.kks.....",
];

const groom = [
  "......................",
  ".........r....r.......",
  ".........ki..ik.......",
  "........kkrrkkkk......",
  "........kkkkkkkkk.....",
  "........kkkkkkkkk.....",
  "........kkckkkckkk....",
  "........kkkkkkknkkk...",
  ".........kkkkkkkkk....",
  "........kkkkkkkkk.....",
  ".......kkkkkkkkkkk....",
  ".......kkkkkkkkkkk....",
  "..k....kkkkkkkkkkk....",
  "..kkkkkkkkkkkkkkkk....",
  "........ssskk.sss.....",
];

const sleep = [
  "......................",
  "......................",
  "......................",
  "......................",
  "......................",
  "......................",
  "......................",
  "......................",
  "..............r...r...",
  "..............ki.ik...",
  ".......kkrrkkkkkkkkk..",
  ".....kkkkkkkkkkkkkkkk.",
  "....kkkkkkkkkkcckkcck.",
  "...kkkkkkkkkkkkkkkknk.",
  "...kkkkssssssssssssk..",
];

const eat = [
  "......................",
  "......................",
  ".....r................",
  ".....k................",
  "....k.................",
  "....k.................",
  ".....k................",
  ".....kkrrkkkk.........",
  ".....kkkkkkkkkr...r...",
  "......kkkkkkkkki.ik...",
  "......ssssssskkkkkkkk.",
  "......kk....kkkcckcck.",
  "......kk....kkkBBBBBBB",
  "......kk....kk.bfbbbbb",
  "...............bbbbbb.",
];

const crouch = [
  "......................",
  "......................",
  "....r.................",
  "....k.................",
  "....k.................",
  ".....k................",
  ".....k................",
  ".....kkrrkkkk.........",
  ".....kkkkkkkkkr...r...",
  "......kkkkkkkkki.ik...",
  "......ssssssskkkkkkkk.",
  "......kk....kkkekkkekw",
  "......kk....kkkEkkkEkw",
  "......kk....kk.kkkkknk",
  "......................",
];

export const FRAMES = { walkA, walkB, sit, blink, happy, groom, sleep, eat, crouch } as const;
export type FrameName = keyof typeof FRAMES;

export const YARN = [".yYy..", "yYyyy.", "yyYyy.", "yyyYy.", ".yyy.."];
/** A page torn from a diary: what Ink brings back when she fetches one. */
export const PAGE = ["PPPPPp", "PLLLPp", "PPPPPp", "PLLPPp", "PPPPpp"];
export const PAGE_PALETTE: Record<string, string> = { P: "#efe6d6", p: "#c9bda6", L: "#8a7f6b" };
export const FISH = ["..ff....", ".ffff.f.", "fkffffff", ".ffff.f.", "..ff...."];
export const BOWL = ["BBBBBBBB", "bbbbbbbb", ".bbbbbb."];

/** Paint a frame into a 2D canvas context at 1 unit per pixel. */
export function paint(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  ox = 0,
  oy = 0,
  palette: Record<string, string> = PALETTE,
) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}
