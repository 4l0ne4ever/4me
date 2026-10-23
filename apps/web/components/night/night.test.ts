import { describe, expect, it } from "vitest";
import { seasonFx } from "./calendar";
import { skyColours, skyLine } from "./sky";

describe("the season on the desktop", () => {
  const on = (iso: string) => seasonFx(new Date(iso));
  it("follows Vietnam's calendar: festivals first, then the season", () => {
    expect(on("2026-10-22T12:00:00Z")).toBe("bats");
    expect(on("2026-09-25T12:00:00Z")).toBe("lanterns");
    expect(on("2027-02-03T12:00:00Z")).toBe("mai");
    expect(on("2026-12-24T12:00:00Z")).toBe("snow");
    expect(on("2027-01-12T12:00:00Z")).toBe("drizzle");
    expect(on("2026-04-10T12:00:00Z")).toBe("petals");
    expect(on("2026-07-10T12:00:00Z")).toBe("fireflies");
    expect(on("2026-11-12T12:00:00Z")).toBe("leaves");
  });
});

describe("tonight's sky", () => {
  it("says what most pages feel, or that it is mixed, or nothing at all", () => {
    expect(skyLine(null)).toBeNull();
    expect(skyLine({ night: "x", total: 0, tones: [] })).toBeNull();
    expect(skyLine({ night: "x", total: 1, tones: [{ tone: "tired", count: 1 }] })).toBe(
      "One page so far tonight, and it feels tired.",
    );
    expect(
      skyLine({
        night: "x",
        total: 7,
        tones: [
          { tone: "blue", count: 4 },
          { tone: "warm", count: 3 },
        ],
      }),
    ).toBe("Tonight the sky is mostly blue: 4 of 7 pages.");
    expect(skyColours({ night: "x", total: 2, tones: [{ tone: "calm", count: 2 }] })).toEqual(["#2c7f7b", "#2c7f7b"]);
  });
});
