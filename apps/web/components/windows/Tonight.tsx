"use client";

import type { EntrySummary, Me } from "@4me/shared";
import { useEffect, useState } from "react";
import { API_URL, dayOf, hhmm, shortDate } from "@/lib/api";
import { useFresh, useLiveEvent } from "@/lib/live";
import { myFeed } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";
import { useDesk } from "../DeskShell";
import { Eq } from "../Icons";

function when(iso: string): string {
  return dayOf(iso) === dayOf(new Date()) ? `tonight, ${hhmm(iso)}` : `${shortDate(iso)}, ${hhmm(iso)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "hasn't written yet";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "wrote just now";
  if (h < 24) return `wrote ${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `wrote ${d} d ago` : `wrote ${shortDate(iso)}`;
}

function Pages({ list, fresh, ranked = false }: { list: EntrySummary[]; fresh: Set<number>; ranked?: boolean }) {
  const List = ranked ? "ol" : "ul";
  return (
    // A chart is an ordered list, so a screen reader counts it too.
    <List className={`tn-list${ranked ? " tn-ranked" : ""}`} aria-live="polite">
      {list.map((e, i) => (
        <li key={e.id} className={fresh.has(e.id) ? "tn-new" : undefined}>
          {ranked && (
            <span className="tn-rank" aria-hidden="true">
              {i + 1}
            </span>
          )}
          <DeskLink className="tn-av" href={`/u/${e.author.handle}`} aria-label={`${e.author.name}'s diary`}>
            <img src={e.author.avatar} alt="" width={40} height={40} />
          </DeskLink>
          <div>
            <DeskLink className="tn-title" href={`/u/${e.author.handle}/${e.slug}`}>
              {e.title}
            </DeskLink>
            {fresh.has(e.id) && <span className="tn-badge">new</span>}
            <small>
              <DeskLink href={`/u/${e.author.handle}`}>{e.author.name}</DeskLink> · {when(e.writtenAt)}
              {e.sealedUntil
                ? ` · ✉ sealed until ${shortDate(e.sealedUntil)}`
                : `${e.mood ? ` · ${e.mood}` : ""} · ${e.noteCount} ${e.noteCount === 1 ? "note" : "notes"}`}
            </small>
            {e.song && (
              <span className="tn-song">
                <Eq />
                {e.song.artist} – {e.song.title}
              </span>
            )}
          </div>
        </li>
      ))}
    </List>
  );
}

/** Everyone's newest pages, like a LiveJournal friends page: who wrote, what, and the song that was on. */
export function Tonight({ recent, me, onWrite }: { recent: EntrySummary[]; me: Me | null; onWrite: () => void }) {
  const { subscriptions } = useDesk();
  const [tab, setTab] = useState<"everyone" | "loved" | "subs">("everyone");
  const [loved, setLoved] = useState<EntrySummary[] | null>(null);
  const [list, setList] = useState(recent);
  const [feed, setFeed] = useState<EntrySummary[] | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const following = new Set(subscriptions?.map((s) => s.handle));
  useFresh<EntrySummary[]>(`${API_URL}/entries?limit=30`, setList);

  useEffect(() => {
    if (tab === "subs" && me) void myFeed().then(setFeed);
    if (tab === "loved")
      void fetch(`${API_URL}/entries/favourites`)
        .then((r) => (r.ok ? (r.json() as Promise<EntrySummary[]>) : []))
        .then(setLoved, () => setLoved([]));
  }, [tab, me]);

  // New pages arrive while the window is open; ones from subscribed diaries join that list too.
  useLiveEvent((e) => {
    if (e.type !== "entry") return;
    const add = (l: EntrySummary[]) => (l.some((x) => x.id === e.entry.id) ? l : [e.entry, ...l].slice(0, 30));
    setList(add);
    if (following.has(e.entry.author.handle)) setFeed((f) => (f ? add(f) : f));
    setFresh((f) => new Set(f).add(e.entry.id));
  });

  const panel = (
    <>
      {tab === "everyone" ? (
        <>
          {list.length === 0 && <p className="tn-empty">Nobody has written yet. The first page could be yours.</p>}
          <Pages list={list} fresh={fresh} />
        </>
      ) : tab === "loved" ? (
        <>
          <p className="tn-note">The pages readers answered most this week: notes, reactions, then reads.</p>
          {loved === null && <p className="tn-empty">Loading…</p>}
          {loved?.length === 0 && (
            <p className="tn-empty">No page has been answered this week yet. Leave a note on one you liked.</p>
          )}
          {loved && loved.length > 0 && <Pages list={loved} fresh={fresh} ranked />}
        </>
      ) : (
        <>
          {subscriptions && subscriptions.length > 0 && (
            <ul className="tn-subs">
              {subscriptions.map((s) => (
                <li key={s.handle}>
                  <DeskLink href={`/u/${s.handle}`}>
                    <img src={s.avatar} alt="" width={28} height={28} />
                    <span>
                      <b>{s.name}</b>
                      <small>{ago(s.lastWroteAt)}</small>
                    </span>
                  </DeskLink>
                </li>
              ))}
            </ul>
          )}
          {subscriptions?.length === 0 && (
            <p className="tn-empty">
              No subscriptions yet. Open a diary you like and press <b>Subscribe</b>: its new pages will show up here
              and ring your bell.
            </p>
          )}
          {feed === null && subscriptions && subscriptions.length > 0 && <p className="tn-empty">Loading…</p>}
          {feed && <Pages list={feed} fresh={fresh} />}
        </>
      )}
    </>
  );

  return (
    <div className="body tonight">
      <div className="tn-head">
        {me ? (
          <>
            <span>
              Logged on as <DeskLink href={`/u/${me.handle}`}>{me.displayName}</DeskLink>
            </span>
            <button type="button" className="btn" onClick={onWrite}>
              Write tonight&apos;s page
            </button>
          </>
        ) : (
          <>
            <span>Everyone here keeps a night diary.</span>
            <a className="btn" href="/welcome?start=register">
              Start yours
            </a>
          </>
        )}
      </div>
      <div className="wr-tabs" role="tablist" aria-label="Which pages">
        <button
          type="button"
          role="tab"
          className="wr-tab"
          id="tn-tab-everyone"
          aria-selected={tab === "everyone"}
          aria-controls="tn-panel"
          onClick={() => setTab("everyone")}
        >
          Everyone
        </button>
        <button
          type="button"
          role="tab"
          className="wr-tab"
          id="tn-tab-loved"
          aria-selected={tab === "loved"}
          aria-controls="tn-panel"
          onClick={() => setTab("loved")}
        >
          Loved this week
        </button>
        {me && (
          <button
            type="button"
            role="tab"
            className="wr-tab"
            id="tn-tab-subs"
            aria-selected={tab === "subs"}
            aria-controls="tn-panel"
            onClick={() => setTab("subs")}
          >
            Subscriptions{subscriptions?.length ? ` (${subscriptions.length})` : ""}
          </button>
        )}
      </div>
      <div id="tn-panel" role="tabpanel" aria-labelledby={`tn-tab-${tab}`}>
        {panel}
      </div>
    </div>
  );
}
