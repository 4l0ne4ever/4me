import type { Almost, Blast, CatStats, Entry, EntrySummary, Note, Shout } from "@4me/shared";
import type { DesktopData } from "@/components/Desktop";
import { apiGet } from "./api";

/** Everything the desktop shows, fetched in parallel. Any piece that fails falls back to empty. */
export async function loadDesktop(slug?: string): Promise<DesktopData> {
  const [entry, entries, shouts, blasts, almost, cat] = await Promise.all([
    apiGet<Entry>(slug ? `/entries/${encodeURIComponent(slug)}` : "/entries/latest", 30),
    apiGet<EntrySummary[]>("/entries?limit=30", 60),
    apiGet<Shout[]>("/guestbook", 15),
    apiGet<Blast[]>("/blasts", 60),
    apiGet<Almost[]>("/almost", 120),
    apiGet<CatStats>("/cat", 60),
  ]);
  const notes = entry ? await apiGet<Note[]>(`/entries/${entry.slug}/notes`, 10) : null;
  return {
    entry,
    entries: entries ?? [],
    notes: notes ?? [],
    shouts: shouts ?? [],
    blasts: blasts ?? [],
    almost: almost ?? [],
    cat: cat ?? { pets: 0, fish: 0, plays: 0 },
  };
}
