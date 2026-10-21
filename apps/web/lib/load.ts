import type { Almost, Blast, Entry, EntrySummary, Note, Profile, RecentNote, Shout } from "@4me/shared";
import type { DesktopData } from "@/components/DeskPage";
import { apiGet } from "./api";

const q = encodeURIComponent;

/**
 * Everything a desktop shows, fetched in parallel; any piece that fails falls back to empty.
 * Without a handle it is the front desktop: everyone's pages, the newest notes on all of them and the shared
 * no guestbook (each diary keeps its own), and no one page open: the front page belongs to nobody.
 * With one it is that member's desktop, or null when there is no such member.
 */
export async function loadDesktop({
  handle,
  slug,
}: {
  handle?: string;
  slug?: string;
} = {}): Promise<DesktopData | null> {
  const owner = handle ? await apiGet<Profile>(`/profiles/${q(handle)}`, 60) : null;
  if (handle && !owner) return null;
  const who = owner?.handle;
  const [entry, entries, recent, shouts, recentNotes] = await Promise.all([
    who ? apiGet<Entry>(slug ? `/entries/by/${q(who)}/${q(slug)}` : `/entries/latest?author=${q(who)}`, 30) : null,
    who ? apiGet<EntrySummary[]>(`/entries?author=${q(who)}&limit=30`, 60) : null,
    apiGet<EntrySummary[]>("/entries?limit=30", 30),
    who ? apiGet<Shout[]>(`/guestbook?owner=${q(who)}`, 15) : null,
    who ? null : apiGet<RecentNote[]>("/entries/notes/recent", 10),
  ]);
  // Blasts and the bin belong to a diary's owner. The front page is everyone's, so it shows nobody's.
  const [notes, blasts, almost] = await Promise.all([
    entry ? apiGet<Note[]>(`/entries/${entry.id}/notes`, 10) : null,
    who ? apiGet<Blast[]>(`/blasts?author=${q(who)}`, 60) : null,
    who ? apiGet<Almost[]>(`/almost?author=${q(who)}`, 120) : null,
  ]);
  return {
    owner,
    entry,
    entries: (who ? entries : recent) ?? [],
    recent: recent ?? [],
    notes: notes ?? [],
    recentNotes: recentNotes ?? [],
    shouts: shouts ?? [],
    blasts: blasts ?? [],
    almost: almost ?? [],
  };
}
