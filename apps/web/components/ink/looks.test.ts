import { OUTFITS } from "@4me/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOK,
  HAT_ROOM,
  hatFor,
  lightness,
  loadLook,
  outfitToday,
  paletteFor,
  seasonalOutfit,
  withCollar,
} from "./looks";
import { FRAMES, type FrameName, H, PALETTE, W } from "./sprites";

const frames = Object.keys(FRAMES) as FrameName[];

describe("her colours", () => {
  it("keeps the black cat exactly as she was drawn", () => {
    const p = paletteFor(DEFAULT_LOOK);
    for (const ch of ["k", "s", "r", "e", "E", "c", "w", "i"]) expect(p[ch]).toBe(PALETTE[ch]);
  });

  it("shades another fur from the fur itself: a darker shadow, a lighter rim", () => {
    const p = paletteFor({ ...DEFAULT_LOOK, fur: "#d07a35" });
    expect(p.k).toBe("#d07a35");
    expect(lightness(p.s!)).toBeLessThan(lightness("#d07a35"));
    expect(lightness(p.r!)).toBeGreaterThan(lightness("#d07a35"));
  });

  it("draws closed eyes and whiskers dark on a white cat, so they still show", () => {
    const p = paletteFor({ ...DEFAULT_LOOK, fur: "#eef0f4" });
    expect(lightness(p.c!)).toBeLessThan(0.5);
    expect(lightness(p.w!)).toBeLessThan(lightness("#eef0f4"));
  });

  it("falls back to the default look for anything broken", () => {
    expect(loadLook(null)).toEqual(DEFAULT_LOOK);
    expect(loadLook({ ...DEFAULT_LOOK, fur: "red" })).toEqual(DEFAULT_LOOK);
    expect(loadLook({ ...DEFAULT_LOOK, name: "Mochi" }).name).toBe("Mochi");
  });
});

describe("her collar", () => {
  it("is painted on her fur in every frame, never on thin air", () => {
    for (const f of frames) {
      const dressed = withCollar(f, FRAMES[f]).join("");
      expect(dressed.match(/l/g)?.length ?? 0, f).toBeGreaterThanOrEqual(3);
      expect(dressed, f).toContain("g");
      expect(dressed.replace(/[lg]/g, "k").length).toBe(FRAMES[f].join("").length);
    }
  });
});

describe("her hats", () => {
  it("fit inside the hat layer in every frame", () => {
    for (const o of OUTFITS)
      for (const f of frames) {
        const hat = hatFor(o, f);
        expect(hat.x, `${o} ${f}`).toBeGreaterThanOrEqual(0);
        expect(hat.y, `${o} ${f}`).toBeGreaterThanOrEqual(0);
        expect(hat.x + (hat.rows[0]?.length ?? 0), `${o} ${f}`).toBeLessThanOrEqual(W);
        expect(hat.y + hat.rows.length, `${o} ${f}`).toBeLessThanOrEqual(H + HAT_ROOM);
      }
  });
});

describe("the seasons", () => {
  const on = (iso: string) => seasonalOutfit(new Date(iso));
  it("follows the festivals first, then the season", () => {
    expect(on("2026-10-22T12:00:00Z")).toBe("witch");
    expect(on("2026-02-14T12:00:00Z")).toBe("mai");
    expect(on("2026-12-24T12:00:00Z")).toBe("santa");
    expect(on("2027-01-05T12:00:00Z")).toBe("beanie");
    expect(on("2026-04-10T12:00:00Z")).toBe("flowers");
    expect(on("2026-07-10T12:00:00Z")).toBe("straw");
    expect(on("2026-09-10T12:00:00Z")).toBe("leaf");
  });

  it("goes by the date in Vietnam, not in London", () => {
    // 19 October in London, already 20 October in Hà Nội
    expect(on("2026-10-19T18:00:00Z")).toBe("witch");
  });

  it("wears what was chosen, or nothing", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    expect(outfitToday({ ...DEFAULT_LOOK, outfit: "santa" }, now)).toBe("santa");
    expect(outfitToday({ ...DEFAULT_LOOK, outfit: "none" }, now)).toBeNull();
    expect(outfitToday(DEFAULT_LOOK, now)).toBe("straw");
  });
});
