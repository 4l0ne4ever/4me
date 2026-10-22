import type { Digest } from "@4me/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { digestMail, digestSubject } = await import("./mail");

const page = (title: string, author = "Fern") => ({
  title,
  slug: "x",
  handle: author.toLowerCase(),
  author,
  mood: "",
  excerpt: "words",
  writtenAt: "2026-10-22T00:00:00Z",
});
const d = (pages: Digest["pages"]): Digest => ({ userId: 1, email: "owl@x.co", name: "Owl", pages });
const stop = {
  page: "https://2die429.com/unsubscribe?u=1&t=a",
  oneClick: "https://2die429.com/api/unsubscribe?u=1&t=a",
};

describe("the morning email", () => {
  it("names the writer, or counts the pages", () => {
    expect(digestSubject(d([page("Rain")]))).toBe("Fern wrote a new page: Rain");
    expect(digestSubject(d([page("Rain"), page("Fog")]))).toBe("Fern wrote 2 new pages");
    expect(digestSubject(d([page("Rain"), page("Fog", "Lan"), page("Ice", "Vy")]))).toBe(
      "3 new pages from Fern, Lan and others",
    );
  });

  it("escapes what writers typed, links each page, and carries one-click unsubscribe", () => {
    const m = digestMail(d([page('<script>alert("x")</script>')]), "https://2die429.com", stop);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.text).toContain("https://2die429.com/u/fern/x");
    expect(m.html).toContain(stop.page.replace(/&/g, "&amp;"));
    expect(m.headers).toEqual({
      "List-Unsubscribe": `<${stop.oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
