import { describe, expect, it } from "vitest";
import { readUploadTicket, signUploadTicket } from "./upload-ticket";

describe("upload tickets", () => {
  it("round-trips the member id while fresh", async () => {
    const t = await signUploadTicket(7, "secret", 1_000);
    expect(t).toMatch(/^v1\.7\.601000\.[A-Za-z0-9_-]{43}$/);
    expect(await readUploadTicket(t, "secret", 2_000)).toBe(7);
  });

  it("refuses forged, altered, expired or far-future tickets", async () => {
    const t = await signUploadTicket(7, "secret", 1_000);
    expect(await readUploadTicket(t, "other", 2_000)).toBeNull();
    expect(await readUploadTicket(t.replace("v1.7.", "v1.8."), "secret", 2_000)).toBeNull();
    expect(await readUploadTicket(t, "secret", 700_000)).toBeNull();
    expect(await readUploadTicket(await signUploadTicket(7, "secret", 1_000, 3_600_000), "secret", 2_000)).toBe(7);
    const far = `v1.7.${10 ** 13}.${t.split(".")[3]}`;
    expect(await readUploadTicket(far, "secret", 2_000)).toBeNull();
    expect(await readUploadTicket("", "secret")).toBeNull();
  });
});
