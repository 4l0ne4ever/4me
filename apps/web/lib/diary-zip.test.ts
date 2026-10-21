import type { DiaryExport } from "@4me/shared";
import { describe, expect, it } from "vitest";
import { diaryTexts, pageMarkdown, photoPaths } from "./diary-zip";

const diary: DiaryExport = {
  exportedAt: "2026-10-21T15:00:00.000Z",
  writer: { name: "Lan", handle: "lan", bio: "", joinedAt: "2026-01-01T00:00:00.000Z", lastfm: null },
  pages: [
    {
      title: "The last tram",
      slug: "the-last-tram",
      body: "It came late.\n\n[photo 2]\n\nI got on anyway.",
      mood: "tired",
      weather: "",
      writtenAt: "2026-10-20T16:30:00.000Z",
      visibility: "private",
      opensAt: null,
      song: { title: "Holocene", artist: "Bon Iver", url: null },
      photos: [
        { url: "/media/u/2/aaaaaaaa.jpg", caption: "the stop" },
        { url: "/media/u/2/bbbbbbbb.jpg", caption: "inside" },
      ],
      readCount: 3,
      notes: [
        { id: 1, replyTo: null, name: "moth", body: "same tram", at: "2026-10-20T17:00:00.000Z" },
        { id: 2, replyTo: 1, name: "Lan", body: "small city", at: "2026-10-20T17:05:00.000Z" },
      ],
    },
  ],
  blasts: [{ body: "rain again", at: "2026-10-19T12:00:00.000Z" }],
  almost: [],
  guestbook: [],
};

describe("taking a diary home", () => {
  it("names photos after their page and day (in the site's time zone)", () => {
    expect([...photoPaths(diary).values()]).toEqual([
      "photos/2026-10-20-the-last-tram-1.jpg",
      "photos/2026-10-20-the-last-tram-2.jpg",
    ]);
  });

  it("writes a page as Markdown: front matter, inline photos where they were, the rest after, notes as a thread", () => {
    const md = pageMarkdown(diary.pages[0]!, photoPaths(diary));
    expect(md).toContain('title: "The last tram"');
    expect(md).toContain("visibility: private");
    expect(md).toContain('song: "Bon Iver – Holocene"');
    expect(md).toContain("It came late.\n\n![inside](../photos/2026-10-20-the-last-tram-2.jpg)\n\nI got on anyway.");
    expect(md.indexOf("![the stop]")).toBeGreaterThan(md.indexOf("I got on anyway."));
    expect(md).toContain("- **moth** (2026-10-21): same tram\n  - **Lan** (2026-10-21): small city");
  });

  it("doesn't repeat the day when the address already starts with it", () => {
    const dated = { ...diary, pages: [{ ...diary.pages[0]!, slug: "2026-10-20-the-last-tram" }] };
    expect([...diaryTexts(dated, photoPaths(dated)).keys()][0]).toBe("pages/2026-10-20-the-last-tram.md");
  });

  it("packs pages, blasts, the whole diary as JSON and a readme, and leaves out empty lists", () => {
    const files = [...diaryTexts(diary, photoPaths(diary)).keys()];
    expect(files).toEqual(["pages/2026-10-20-the-last-tram.md", "blasts.md", "diary.json", "README.txt"]);
  });
});
