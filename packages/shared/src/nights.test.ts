import { describe, expect, it } from "vitest";
import { moodTone, nightOf, nightShift, PROMPTS, promptFor } from "./nights";

describe("a night", () => {
  it("runs from six in the evening's morning to six the next, in Vietnam", () => {
    expect(nightOf(new Date("2026-10-22T15:00:00Z"))).toBe("2026-10-22"); // 22:00 in Hà Nội
    expect(nightOf(new Date("2026-10-22T19:30:00Z"))).toBe("2026-10-22"); // 02:30 the next morning
    expect(nightOf(new Date("2026-10-22T23:00:00Z"))).toBe("2026-10-23"); // 06:00 the next morning
    expect(nightShift("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("has one question all night, and another the next", () => {
    expect(promptFor("2026-10-22")).toBe(promptFor("2026-10-22"));
    expect(promptFor("2026-10-22")).not.toBe(promptFor("2026-10-23"));
    const seen = new Set(Array.from({ length: PROMPTS.length }, (_, i) => promptFor(nightShift("2026-01-01", i))));
    expect(seen.size).toBe(PROMPTS.length);
  });

  it("reads moods in English and Vietnamese", () => {
    expect(moodTone("tired, fine")).toBe("tired");
    expect(moodTone("buồn")).toBe("blue");
    expect(moodTone("sleepless")).toBe("restless");
    expect(moodTone("vui vẻ")).toBe("warm");
    expect(moodTone("drifting")).toBe("drifting");
    expect(moodTone("")).toBeNull();
    expect(moodTone("purple")).toBeNull();
  });
});
