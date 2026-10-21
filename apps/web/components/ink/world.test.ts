import { describe, expect, it } from "vitest";
import { GROUND, landing, type Plat, plan } from "./world";

const W = 1440;
const CAT = 66;
const tonight: Plat = { id: "win:tonight", left: 150, right: 610, y: 780 };
const roof: Plat = { id: "roof:3", left: 900, right: 930, y: 120 };

describe("Ink's way around the desktop", () => {
  it("walks straight there on the same surface", () => {
    expect(plan({ on: GROUND, x: 100 }, { on: GROUND, x: 700 }, [tonight], W, CAT)).toEqual([{ kind: "walk", x: 700 }]);
  });

  it("climbs the nearer wall of a window to get on top of it", () => {
    expect(plan({ on: GROUND, x: 700 }, { on: tonight.id, x: 300 }, [tonight], W, CAT)).toEqual([
      { kind: "walk", x: 600 },
      { kind: "climb", id: tonight.id, side: "right" },
      { kind: "walk", x: 300 },
    ]);
  });

  it("goes to the nearer edge and hops down before heading somewhere else", () => {
    expect(plan({ on: tonight.id, x: 200 }, { on: roof.id, x: 900 }, [tonight, roof], W, CAT)).toEqual([
      { kind: "walk", x: 117 },
      { kind: "drop" },
      { kind: "walk", x: 845 },
      { kind: "climb", id: roof.id, side: "left" },
      { kind: "walk", x: 900 },
    ]);
  });

  it("climbs the other wall when one is against the edge of the screen", () => {
    const edge: Plat = { id: "win:edge", left: 10, right: 400, y: 500 };
    const steps = plan({ on: GROUND, x: 0 }, { on: edge.id, x: 100 }, [edge], W, CAT);
    expect(steps[1]).toEqual({ kind: "climb", id: edge.id, side: "right" });
  });

  it("lands on the first surface below whatever falls, or the taskbar", () => {
    expect(landing([tonight, roof], 300, 900, 700, W)?.id).toBe(tonight.id);
    expect(landing([tonight, roof], 300, 700, -10, W)?.id).toBe(GROUND);
    expect(landing([tonight, roof], 915, 400, 100, W)?.id).toBe(roof.id);
    expect(landing([tonight, roof], 700, 400, 300, W)).toBeNull();
  });
});
