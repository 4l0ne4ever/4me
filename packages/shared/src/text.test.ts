import { describe, expect, it } from "vitest";
import { entryInput, noteInput } from "./schemas";
import { excerpt, isAwakeHour, parseBody, searchable, slugify } from "./text";

describe("isAwakeHour", () => {
  it("is awake in the evening and the small hours, asleep by day", () => {
    expect([17, 23, 0, 5].every(isAwakeHour)).toBe(true);
    expect([6, 12, 16].some(isAwakeHour)).toBe(false);
  });
});

describe("searchable", () => {
  it("finds Vietnamese with or without marks", () => {
    expect(searchable("  Mưa ĐẦU   mùa ")).toBe("mua dau mua");
    expect(searchable("Em Dạo Này")).toBe("em dao nay");
  });
});

describe("slugify", () => {
  it("prefixes the date and strips Vietnamese marks", () => {
    expect(slugify("Mưa rồi, không ai đón", new Date("2026-10-17T20:00:00Z"))).toBe("2026-10-17-mua-roi-khong-ai-don");
  });
  it("falls back to the date alone", () => {
    expect(slugify("!!!", new Date("2026-10-17T20:00:00Z"))).toBe("2026-10-17");
  });
});

describe("parseBody", () => {
  it("splits paragraphs, notes, photos and crossed-out words", () => {
    const blocks = parseBody("I waited. ~~I thought about calling you.~~ The bus left.\n\n> it will rain\n\n[photo 2]");
    expect(blocks[0]).toEqual({
      kind: "p",
      parts: [
        { kind: "text", text: "I waited. " },
        { kind: "strike", text: "I thought about calling you." },
        { kind: "text", text: " The bus left." },
      ],
    });
    expect(blocks[1]).toEqual({ kind: "note", text: "it will rain" });
    expect(blocks[2]).toEqual({ kind: "photo", index: 1 });
  });
  it("keeps a quote line by line, with whose words they are", () => {
    const [q] = parseBody("| the rain is falling\n| on the _night bus_\n— Mazzy Star");
    expect(q).toEqual({
      kind: "quote",
      lines: [
        [{ kind: "text", text: "the rain is falling" }],
        [
          { kind: "text", text: "on the " },
          { kind: "em", text: "night bus" },
        ],
      ],
      cite: "Mazzy Star",
    });
    expect(parseBody("| just words")[0]).toMatchObject({ kind: "quote", cite: "" });
  });
  it("makes links from [words](address) and from bare addresses, leaving the full stop after one alone", () => {
    const [b] = parseBody("read [this](https://example.com/a_b) and https://2die429.com/u/lan.");
    expect(b).toEqual({
      kind: "p",
      parts: [
        { kind: "text", text: "read " },
        { kind: "link", text: "this", href: "https://example.com/a_b" },
        { kind: "text", text: " and " },
        { kind: "link", text: "2die429.com/u/lan", href: "https://2die429.com/u/lan" },
        { kind: "text", text: "." },
      ],
    });
  });
  it("only ever links http and https", () => {
    const [b] = parseBody("[click](javascript:alert(1)) and [x](data:text/html,hi)");
    expect(b && b.kind === "p" && b.parts.every((p) => p.kind === "text")).toBe(true);
  });
  it("never produces markup from angle brackets", () => {
    const [b] = parseBody("<script>alert(1)</script>");
    expect(b).toEqual({ kind: "p", parts: [{ kind: "text", text: "<script>alert(1)</script>" }] });
  });
});

describe("excerpt", () => {
  it("cuts the first paragraph", () => {
    expect(excerpt("a".repeat(300), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("schemas", () => {
  it("names anonymous notes", () => {
    expect(noteInput.parse({ name: "  ", body: "hi" }).name).toBe("a stranger");
  });
  it("rejects a bad slug", () => {
    expect(entryInput.safeParse({ title: "t", body: "b", slug: "Not OK" }).success).toBe(false);
  });
});
