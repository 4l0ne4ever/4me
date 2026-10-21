"use client";

import type { RecentNote } from "@4me/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, hhmm, shortDate } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { DeskLink } from "../DeskLink";

/**
 * The front desktop's Messenger: it belongs to nobody, so instead of one page's notes it shows the newest notes
 * left on every diary, each with the page it was left on, as they arrive. Notes are written on a page, not here.
 */
export function RecentNotes({ initial, onTonight }: { initial: RecentNote[]; onTonight: () => void }) {
  const [notes, setNotes] = useState(initial);
  const chat = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/entries/notes/recent`, { cache: "no-store" });
      if (res.ok) setNotes((await res.json()) as RecentNote[]);
    } catch {
      // keep what is on screen
    }
  }, []);

  // Fresh on open and after every reconnect (the server copy can be up to half a minute old).
  useEffect(() => {
    void reload();
  }, [reload]);
  // A live note carries no page title, so the list is asked for again; that also drops hidden or deleted notes.
  useLiveEvent((e) => {
    if (e.type === "hello" || e.type === "note" || e.type === "note-gone") void reload();
  });

  const count = useRef(notes.length);
  useEffect(() => {
    if (notes.length !== count.current) chat.current?.parentElement?.scrollTo({ top: 1e6, behavior: "smooth" });
    count.current = notes.length;
  }, [notes]);

  return (
    <>
      <div className="body">
        <p className="chat-hd">Notes left on every diary, newest at the bottom</p>
        <div className="chat" ref={chat} aria-live="polite">
          {notes.length === 0 && <p className="ln sys">No notes yet tonight.</p>}
          {notes.map((n, i) => {
            const day = shortDate(n.createdAt);
            const newDay = i === 0 || shortDate(notes[i - 1]!.createdAt) !== day;
            return (
              <div key={n.id}>
                {newDay && <p className="rn-day">{day}</p>}
                <p className="ln">
                  <span className="t">({hhmm(n.createdAt)})</span>{" "}
                  {n.member && <img className="av" src={n.member.avatar} alt="" width={16} height={16} />}
                  <span className={`n${n.isAuthor ? " own" : ""}`}>
                    {n.member ? <DeskLink href={`/u/${n.member.handle}`}>{n.name}</DeskLink> : n.name}
                  </span>{" "}
                  <span className="rn-on">
                    on <DeskLink href={`/u/${n.page.handle}/${n.page.slug}`}>{n.page.title}</DeskLink>
                    {!n.isAuthor && ` (${n.page.author})`}:
                  </span>{" "}
                  {n.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      <p className="compose-hint">
        Notes are left on a page.{" "}
        <button type="button" className="linkish" onClick={onTonight}>
          Pick one from Tonight
        </button>{" "}
        to write on it.
      </p>
    </>
  );
}
