import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, readSession, safeNext, signSession, verifyPassword } from "./crypto";

describe("passwords", () => {
  it("hashes with a fresh salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
  });
  it("never matches the dummy hash or junk", async () => {
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("anything", "md5$abc")).toBe(false);
  });
});

describe("sessions", () => {
  const secret = "s".repeat(32);
  it("round-trips a signed session", () => {
    const token = signSession({ uid: 7, sv: 2, exp: 2_000 }, secret);
    expect(readSession(token, secret, 1_000)).toEqual({ uid: 7, sv: 2, exp: 2_000 });
  });
  it("rejects tampering, the wrong key and expiry", () => {
    const token = signSession({ uid: 7, sv: 2, exp: 2_000 }, secret);
    expect(readSession(token.replace("v1.7.", "v1.8."), secret, 1_000)).toBeNull();
    expect(readSession(token, "t".repeat(32), 1_000)).toBeNull();
    expect(readSession(token, secret, 3_000)).toBeNull();
    expect(readSession("garbage", secret)).toBeNull();
  });
});

describe("safeNext", () => {
  it("allows only same-site paths", () => {
    expect(safeNext("/n/the-lamps")).toBe("/n/the-lamps");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
