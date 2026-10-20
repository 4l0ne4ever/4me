// The reader's desktop background. Pure helpers here; browser storage lives in wallpaper-store.ts.

export type Fit = "fill" | "fit" | "center" | "tile";
export type Wallpaper =
  | { source: "skin" }
  | { source: "preset"; id: string }
  | { source: "upload" }
  | { source: "color"; id: string };
export type WallpaperPref = { wallpaper: Wallpaper; fit: Fit };

export const PRESETS = [
  { id: "pines", name: "Pines in fog", url: "/photos/pic-229.jpg" },
  { id: "boathouse", name: "Boathouse", url: "/photos/pic-594.jpg" },
  { id: "blue-mist", name: "Blue mist", url: "/photos/pic-877.jpg" },
  { id: "bare-trees", name: "Bare trees", url: "/photos/pic-878.jpg" },
  { id: "first-snow", name: "First snow", url: "/photos/pic-726.jpg" },
  { id: "red-leaves", name: "Red leaves", url: "/photos/pic-923.jpg" },
  { id: "grey-shore", name: "Grey shore", url: "/photos/pic-338.jpg" },
] as const;

export const COLORS = [
  { id: "teal", name: "Teal, 1995", color: "#008080" },
  { id: "w2k", name: "Windows 2000 blue", color: "#3a6ea5" },
  { id: "midnight", name: "Midnight", color: "#0b1220" },
] as const;

export const FITS: Array<{ id: Fit; name: string }> = [
  { id: "fill", name: "Fill" },
  { id: "fit", name: "Fit" },
  { id: "center", name: "Center" },
  { id: "tile", name: "Tile" },
];

export const DEFAULT_PREF: WallpaperPref = { wallpaper: { source: "skin" }, fit: "fill" };
export const PREF_KEY = "4me-wallpaper";

/** Reads a stored preference, falling back to the skin's own wallpaper for anything unknown. */
export function parsePref(raw: string | null): WallpaperPref {
  if (!raw) return DEFAULT_PREF;
  try {
    const v = JSON.parse(raw) as Partial<WallpaperPref> & { wallpaper?: Partial<Wallpaper> & { id?: string } };
    const fit: Fit = FITS.some((f) => f.id === v.fit) ? (v.fit as Fit) : "fill";
    const w = v.wallpaper;
    if (w?.source === "preset" && PRESETS.some((p) => p.id === w.id))
      return { wallpaper: { source: "preset", id: w.id! }, fit };
    if (w?.source === "color" && COLORS.some((c) => c.id === w.id))
      return { wallpaper: { source: "color", id: w.id! }, fit };
    if (w?.source === "upload") return { wallpaper: { source: "upload" }, fit };
    return { wallpaper: { source: "skin" }, fit };
  } catch {
    return DEFAULT_PREF;
  }
}

export type Background = { kind: "image"; url: string; fit: Fit } | { kind: "color"; color: string };

/**
 * What to paint. The skin's wallpaper follows the day (a grey one while the diary sleeps);
 * a picture the reader chose stays, it only gets the daytime wash from CSS.
 */
export function resolveBackground(
  pref: WallpaperPref,
  opts: { skinWall: string; dayWall: string; awake: boolean; uploadUrl: string | null },
): Background {
  const w = pref.wallpaper;
  if (w.source === "color") {
    const c = COLORS.find((x) => x.id === w.id);
    if (c) return { kind: "color", color: c.color };
  }
  if (w.source === "preset") {
    const p = PRESETS.find((x) => x.id === w.id);
    if (p) return { kind: "image", url: p.url, fit: pref.fit };
  }
  if (w.source === "upload" && opts.uploadUrl) return { kind: "image", url: opts.uploadUrl, fit: pref.fit };
  return { kind: "image", url: opts.awake ? opts.skinWall : opts.dayWall, fit: "fill" };
}

/** Scales a picture down so its longest side is at most `max`, never up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/** A reason the file can't be used, or null when it can. */
export function rejectFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "That isn't a picture this desktop can show. Try a JPG, PNG or WebP.";
  if (file.size > MAX_UPLOAD_BYTES) return "That picture is over 20 MB. Try a smaller one.";
  return null;
}
