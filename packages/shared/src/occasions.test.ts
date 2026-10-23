import { describe, expect, it } from "vitest";
import { promptFor } from "./nights";
import { fullMoonNear, nightEventInput, nightTime, occasionOf, questionFor } from "./occasions";

describe("the nights the calendar makes special", () => {
  it("finds the full moon to within minutes", () => {
    // 2024-09-18 02:34 UTC and 2026-10-26 04:12 UTC, from published tables
    const a = fullMoonNear(new Date("2024-09-17T00:00:00Z")).getTime();
    expect(Math.abs(a - Date.parse("2024-09-18T02:34:00Z"))).toBeLessThan(5 * 60_000);
    const b = fullMoonNear(new Date("2026-10-28T00:00:00Z")).getTime();
    expect(Math.abs(b - Date.parse("2026-10-26T04:12:00Z"))).toBeLessThan(5 * 60_000);
  });

  it("names the nights, one each, and leaves ordinary nights alone", () => {
    expect(occasionOf("2026-10-26")?.key).toBe("fullmoon");
    expect(occasionOf("2026-10-25")).toBeNull();
    expect(occasionOf("2026-10-31")?.key).toBe("halloween");
    expect(occasionOf("2026-12-21")?.key).toBe("solstice");
    expect(occasionOf("2026-09-25")?.key).toBe("midautumn");
    expect(occasionOf("2027-02-05")?.key).toBe("newyear");
    let special = 0;
    for (let i = 0; i < 365; i++)
      if (occasionOf(new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10))) special++;
    // twelve or thirteen full moons and a handful of feasts: rare enough to stay special
    expect(special).toBeGreaterThan(14);
    expect(special).toBeLessThan(20);
  });

  it("asks the moderator's question first, then the calendar's, then the rotation's", () => {
    expect(questionFor("2026-10-25")).toBe(promptFor("2026-10-25"));
    expect(questionFor("2026-10-31")).toBe("What still scares you, a little?");
    const event = {
      id: 1,
      night: "2026-10-31",
      title: "x",
      body: "",
      question: "Mine?",
      startsAt: null,
      endsAt: null,
      shift: false,
    };
    expect(questionFor("2026-10-31", event)).toBe("Mine?");
  });

  it("reads a time of the night as that evening, or the small hours after it", () => {
    expect(nightTime("2026-10-31", "23:00").toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(nightTime("2026-10-31", "01:30").toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(nightEventInput.safeParse({ night: "2026-10-31", title: "Night shift", shift: true }).success).toBe(false);
  });
});
