import { describe, expect, it } from "vitest";
import { fromAddress, toAddress } from "./address";

describe("the address bar", () => {
  it("shows where you are", () => {
    expect(toAddress("/")).toBe("4me://tonight");
    expect(toAddress("/u/lan")).toBe("4me://lan");
    expect(toAddress("/u/lan/the-last-tram")).toBe("4me://lan/the-last-tram");
  });

  it("goes where you type", () => {
    expect(fromAddress("lan")).toBe("/u/lan");
    expect(fromAddress(" 4me://Lan/the-last-tram ")).toBe("/u/lan/the-last-tram");
    expect(fromAddress("/u/lan/")).toBe("/u/lan");
    expect(fromAddress("tonight")).toBe("/");
    expect(fromAddress("")).toBe("/");
  });

  it("refuses anything that isn't a diary address", () => {
    for (const bad of ["https://evil.example", "//evil.example", "lan/../../admin", "a", "lan/x/y", "<script>"]) {
      expect(fromAddress(bad)).toBeNull();
    }
  });
});
