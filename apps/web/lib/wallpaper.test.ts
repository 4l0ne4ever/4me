import { describe, expect, it } from "vitest";
import { DEFAULT_PREF, fitWithin, parsePref, rejectFile, resolveBackground } from "./wallpaper";

const opts = { skinWall: "/skin.jpg", dayWall: "/day.jpg", awake: true, uploadUrl: null as string | null };

describe("parsePref", () => {
  it("keeps a valid choice", () => {
    expect(parsePref(JSON.stringify({ wallpaper: { source: "preset", id: "boathouse" }, fit: "tile" }))).toEqual({
      wallpaper: { source: "preset", id: "boathouse" },
      fit: "tile",
    });
  });
  it("falls back for junk, unknown presets and odd fits", () => {
    expect(parsePref("{nope")).toEqual(DEFAULT_PREF);
    expect(parsePref(null)).toEqual(DEFAULT_PREF);
    expect(parsePref(JSON.stringify({ wallpaper: { source: "preset", id: "gone" }, fit: "zoom" }))).toEqual(
      DEFAULT_PREF,
    );
  });
});

describe("resolveBackground", () => {
  it("follows the skin and the day by default", () => {
    expect(resolveBackground(DEFAULT_PREF, opts)).toEqual({ kind: "image", url: "/skin.jpg", fit: "fill" });
    expect(resolveBackground(DEFAULT_PREF, { ...opts, awake: false })).toEqual({
      kind: "image",
      url: "/day.jpg",
      fit: "fill",
    });
  });
  it("keeps the reader's choice by day too", () => {
    const pref = { wallpaper: { source: "preset" as const, id: "first-snow" }, fit: "center" as const };
    expect(resolveBackground(pref, { ...opts, awake: false })).toEqual({
      kind: "image",
      url: "/photos/pic-726.jpg",
      fit: "center",
    });
  });
  it("uses the uploaded picture once it has loaded, the skin until then", () => {
    const pref = { wallpaper: { source: "upload" as const }, fit: "fit" as const };
    expect(resolveBackground(pref, opts).kind === "image" && resolveBackground(pref, opts)).toMatchObject({
      url: "/skin.jpg",
    });
    expect(resolveBackground(pref, { ...opts, uploadUrl: "blob:x" })).toEqual({
      kind: "image",
      url: "blob:x",
      fit: "fit",
    });
  });
  it("paints a flat colour", () => {
    expect(resolveBackground({ wallpaper: { source: "color", id: "teal" }, fit: "fill" }, opts)).toEqual({
      kind: "color",
      color: "#008080",
    });
  });
});

describe("files", () => {
  it("scales big pictures down and leaves small ones alone", () => {
    expect(fitWithin(5120, 2880, 2560)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
  });
  it("turns away non-pictures and huge files", () => {
    expect(rejectFile({ type: "application/pdf", size: 10 })).toMatch(/JPG/);
    expect(rejectFile({ type: "image/png", size: 30 * 1024 * 1024 })).toMatch(/20 MB/);
    expect(rejectFile({ type: "image/webp", size: 1000 })).toBeNull();
  });
});
