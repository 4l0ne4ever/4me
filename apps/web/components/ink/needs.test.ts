import { describe, expect, it } from "vitest";
import { decay, feed, isFull, lineFor, load, moodOf, pet, play } from "./needs";
import { FRAMES, H, W } from "./sprites";

describe("Ink's needs", () => {
  const t0 = 1_000_000;

  it("gets hungrier and lonelier over time, never below zero", () => {
    const n = decay({ hunger: 50, joy: 50, at: t0 }, t0 + 60 * 60_000);
    expect(n.hunger).toBeCloseTo(20);
    expect(n.joy).toBeCloseTo(29);
    expect(decay(n, t0 + 10 * 3600_000).hunger).toBe(0);
  });

  it("feeding, petting and playing move the right needle", () => {
    const n = { hunger: 10, joy: 10, at: t0 };
    expect(feed(n).hunger).toBe(50);
    expect(pet(n).joy).toBe(16);
    expect(play(n)).toMatchObject({ joy: 25, hunger: 6 });
    expect(isFull(feed({ ...n, hunger: 80 }))).toBe(true);
  });

  it("names a mood from the needs", () => {
    expect(moodOf({ hunger: 10, joy: 90, at: t0 })).toBe("starving");
    expect(moodOf({ hunger: 30, joy: 90, at: t0 })).toBe("hungry");
    expect(moodOf({ hunger: 90, joy: 10, at: t0 })).toBe("lonely");
    expect(moodOf({ hunger: 90, joy: 90, at: t0 })).toBe("content");
    expect(lineFor("hungry", 0.99)).toBeTypeOf("string");
  });

  it("survives junk in storage", () => {
    expect(load("not json", t0)).toMatchObject({ hunger: 80, joy: 70 });
    expect(load(JSON.stringify({ hunger: "x" }), t0)).toMatchObject({ hunger: 80 });
  });
});

describe("sprites", () => {
  it("every frame is the same size", () => {
    for (const [name, rows] of Object.entries(FRAMES)) {
      expect(rows, name).toHaveLength(H);
      for (const row of rows) expect(row.length, `${name}: ${row}`).toBe(W);
    }
  });
});
