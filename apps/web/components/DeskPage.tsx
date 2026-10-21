"use client";

import type { Almost as AlmostItem, Blast, Entry, EntrySummary, Note, Profile, Shout } from "@4me/shared";
import { useEffect, useMemo, useState } from "react";
import { apiSend } from "@/lib/api";
import { DeskWindow, useDesk, WINDOWS, type WinId } from "./DeskShell";
import { Almost } from "./windows/Almost";
import { Diary } from "./windows/Diary";
import { Guestbook } from "./windows/Guestbook";
import { Messenger } from "./windows/Messenger";
import { Mixtape } from "./windows/Mixtape";
import { Photos, type Picture } from "./windows/Photos";
import { Tonight } from "./windows/Tonight";

export type DesktopData = {
  /** The member whose diary this is; null on the front page. */
  owner: Profile | null;
  entry: Entry | null;
  /** The owner's pages, or everyone's on the front page. */
  entries: EntrySummary[];
  /** Everyone's newest pages, for the Tonight window. */
  recent: EntrySummary[];
  notes: Note[];
  shouts: Shout[];
  blasts: Blast[];
  almost: AlmostItem[];
};

/** The windows that show one page: they change when the reader goes somewhere else, the computer around them doesn't. */
export function DeskPage({ data }: { data: DesktopData }) {
  const { entry, entries, owner } = data;
  const { me, open, write, setCurrent, buzz, listening, awake } = useDesk();
  /** Who Messenger, the blasts and the bin are about: the diary's owner, or whoever wrote the page that is open. */
  const persona = owner ?? entry?.author ?? null;
  const [photoView, setPhotoView] = useState<number | null>(null);

  // Tell the computer what's on screen (for the live connection and Last.fm), and bring the page forward.
  useEffect(() => {
    setCurrent({ entry, owner, persona });
  }, [entry, owner, persona, setCurrent]);

  useEffect(() => {
    if (entry) void apiSend(`/entries/${entry.id}/read`);
    // The front page leads with everyone's pages; a diary leads with its page.
    if (!owner) open("tonight");
    else if (entry) open("diary");
  }, [entry, owner, open]);

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("open");
    if (want && want in WINDOWS && want !== "account") open(want as WinId);
  }, [open]);

  const pictures = useMemo<Picture[]>(() => {
    const seen = new Set<string>();
    const list: Picture[] = [];
    for (const p of entry?.photos ?? [])
      if (!seen.has(p.url) && seen.add(p.url)) list.push({ ...p, night: entry!.slug });
    for (const e of entries)
      if (e.cover && !seen.has(e.cover.url) && seen.add(e.cover.url)) list.push({ ...e.cover, night: e.slug });
    return list;
  }, [entry, entries]);

  const showPhoto = (url: string) => {
    const i = pictures.findIndex((p) => p.url === url);
    setPhotoView(i >= 0 ? i : 0);
    open("photos");
  };

  /** Every window says whose it is: you are always on your own computer, reading someone's diary. */
  const whose = persona && persona.handle !== me?.handle ? `${persona.name}'s` : persona ? "My" : null;

  return (
    <>
      <DeskWindow id="tonight">
        <Tonight key={data.recent[0]?.id ?? 0} recent={data.recent} me={me} onWrite={() => write(null)} />
      </DeskWindow>
      <DeskWindow id="diary" title={entry ? `${entry.author.name} — ${entry.title}.doc` : undefined}>
        <Diary
          key={entry?.id ?? "none"}
          entry={entry}
          entries={entries}
          notes={data.notes}
          owner={owner}
          awake={awake}
          me={me}
          onEdit={write}
          onPhoto={showPhoto}
          onSong={() => open("amp")}
          onGuestbook={() => open("guest")}
        />
      </DeskWindow>
      <DeskWindow id="msn" title={persona ? `Messenger — ${persona.name}` : undefined}>
        <Messenger
          key={entry?.id ?? "none"}
          entry={entry}
          persona={persona}
          notes={data.notes}
          blasts={data.blasts}
          awake={awake}
          live={listening}
          onBuzz={() => buzz(true)}
          me={me}
        />
      </DeskWindow>
      <DeskWindow id="guest" title={owner ? `${owner.name}'s guestbook` : "Guestbook — everyone"}>
        <Guestbook key={owner?.handle ?? "_"} initial={data.shouts} me={me} owner={owner} />
      </DeskWindow>
      <DeskWindow id="amp" title={whose ? `${whose} mixtape.m3u` : undefined}>
        <Mixtape entries={entries} currentId={entry?.id} live={listening} persona={persona} />
      </DeskWindow>
      <DeskWindow id="photos" title={whose ? `${whose} pictures` : undefined}>
        <Photos pictures={pictures} view={photoView} onView={setPhotoView} />
      </DeskWindow>
      <DeskWindow id="almost" title={whose ? `${whose} almost posted` : undefined}>
        <Almost items={data.almost} persona={persona} />
      </DeskWindow>
    </>
  );
}
