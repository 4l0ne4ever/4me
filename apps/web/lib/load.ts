import type { Almost, Blast, Entry, EntrySummary, Note, Profile, Shout } from "@4me/shared";
import type { DesktopData } from "@/components/DeskPage";
import { apiGet } from "./api";

const q = encodeURIComponent;

/**
 * Everything a desktop shows, fetched in parallel; any piece that fails falls back to empty.
 * Without a handle it is the front desktop: everyone's newest page and the shared guestbook.
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
  const [entry, entries, recent, shouts] = await Promise.all([
    apiGet<Entry>(
      who && slug ? `/entries/by/${q(who)}/${q(slug)}` : who ? `/entries/latest?author=${q(who)}` : "/entries/latest",
      30,
    ),
    who ? apiGet<EntrySummary[]>(`/entries?author=${q(who)}&limit=30`, 60) : null,
    apiGet<EntrySummary[]>("/entries?limit=30", 30),
    apiGet<Shout[]>(who ? `/guestbook?owner=${q(who)}` : "/guestbook", 15),
  ]);
  // Messenger, blasts and the bin belong to whoever the desktop is about: its owner, or the writer of the page open.
  const persona = who ?? entry?.author.handle;
  const [notes, blasts, almost] = await Promise.all([
    entry ? apiGet<Note[]>(`/entries/${entry.id}/notes`, 10) : null,
    persona ? apiGet<Blast[]>(`/blasts?author=${q(persona)}`, 60) : null,
    persona ? apiGet<Almost[]>(`/almost?author=${q(persona)}`, 120) : null,
  ]);
  return {
    owner,
    entry,
    entries: (who ? entries : recent) ?? [],
    recent: recent ?? [],
    notes: notes ?? [],
    shouts: shouts ?? [],
    blasts: blasts ?? [],
    almost: almost ?? [],
  };
}
