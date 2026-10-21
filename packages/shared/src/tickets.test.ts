import { describe, expect, it } from "vitest";
import { readTicket, signTicket } from "./tickets";

describe("tickets", () => {
  it("round-trips the member id while fresh", async () => {
    const t = await signTicket("upload", 7, "secret", 1_000);
    expect(t).toMatch(/^v1\.upload\.7\.601000\.[A-Za-z0-9_-]{43}$/);
    expect(await readTicket("upload", t, "secret", 2_000)).toBe(7);
  });

  it("refuses forged, altered, expired, far-future or other-purpose tickets", async () => {
    const t = await signTicket("upload", 7, "secret", 1_000);
    expect(await readTicket("upload", t, "other", 2_000)).toBeNull();
    expect(await readTicket("upload", t.replace(".7.", ".8."), "secret", 2_000)).toBeNull();
    expect(await readTicket("upload", t, "secret", 700_000)).toBeNull();
    expect(await readTicket("live", t, "secret", 2_000)).toBeNull();
    expect(await readTicket("live", t.replace("upload", "live"), "secret", 2_000)).toBeNull();
    const far = `v1.upload.7.${10 ** 13}.${t.split(".")[4]}`;
    expect(await readTicket("upload", far, "secret", 2_000)).toBeNull();
    expect(await readTicket("upload", "", "secret")).toBeNull();
  });
});
