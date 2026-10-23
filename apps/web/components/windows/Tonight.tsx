"use client";

import { type EntrySummary, type Me, nightShift, occasionOf } from "@4me/shared";
import { useEffect, useState } from "react";
import { API_URL, dayOf, hhmm, shortDate } from "@/lib/api";
import { useFresh, useLiveEvent } from "@/lib/live";
import { myFeed } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";
import { useDesk } from "../DeskShell";
import { Eq } from "../Icons";
import { nudgeInk } from "../ink/Ink";
import { shiftPhase, until } from "../night/plan";
import { skyLine, TONES } from "../night/sky";

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
                ? ` · ✉ sealed until ${dayOf(e.sealedUntil) === dayOf(new Date()) ? hhmm(e.sealedUntil) : shortDate(e.sealedUntil)}`
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
  const { subscriptions, night, sky, answer, awake, navigate, plan, occasion, question, joinShift, shiftView } =
    useDesk();
  const [tab, setTab] = useState<"everyone" | "loved" | "question" | "shift" | "subs">("everyone");
  const [shifted, setShifted] = useState<EntrySummary[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const event = plan?.event ?? null;
  const phase = shiftPhase(event, now);
  const tomorrow = plan?.next ?? (night ? occasionOf(nightShift(night, 1)) : null);
  useEffect(() => {
    if (shiftView) setTab("shift");
  }, [shiftView]);
  const [answers, setAnswers] = useState<EntrySummary[] | null>(null);
  const [turning, setTurning] = useState(false);
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

  // The answers to tonight's question: counted for the button, listed in their tab.
  useEffect(() => {
    if (!night) return;
    void fetch(`${API_URL}/entries?prompt=${night}&limit=30`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EntrySummary[]>) : []))
      .then(setAnswers, () => setAnswers([]));
  }, [night]);

  // The night shift's pages: sealed while it runs, all open together when it ends.
  const shiftId = event?.shift ? event.id : null;
  useEffect(() => {
    if (!shiftId || phase === "before") return;
    void fetch(`${API_URL}/entries?shift=${shiftId}&limit=50`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EntrySummary[]>) : []))
      .then(setShifted, () => setShifted([]));
  }, [shiftId, phase]);

  /** A page, any page: Ink goes and fetches one when she is awake; asleep, it just opens. */
  const turnPage = async () => {
    if (awake) return nudgeInk("fetch");
    setTurning(true);
    try {
      const r = await fetch(`${API_URL}/entries/random`);
      const page = r.ok ? ((await r.json()) as { handle: string; slug: string }) : null;
      if (page) navigate(`/u/${page.handle}/${page.slug}`);
    } finally {
      setTurning(false);
    }
  };

  // New pages arrive while the window is open; ones from subscribed diaries join that list too.
  useLiveEvent((e) => {
    if (e.type !== "entry") return;
    const add = (l: EntrySummary[]) => (l.some((x) => x.id === e.entry.id) ? l : [e.entry, ...l].slice(0, 30));
    setList(add);
    if (night && e.entry.prompt === night) setAnswers((a) => (a ? add(a) : a));
    if (shiftId && e.entry.shift === shiftId) setShifted((l) => add(l ?? []));
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
      ) : tab === "question" ? (
        <>
          {answers === null && <p className="tn-empty">Loading…</p>}
          {answers?.length === 0 && (
            <p className="tn-empty">
              Nobody has answered tonight&apos;s question yet. The first answer could be yours.
            </p>
          )}
          {answers && answers.length > 0 && <Pages list={answers} fresh={fresh} />}
        </>
      ) : tab === "shift" ? (
        <>
          <p className="tn-note">
            {phase === "after"
              ? "Written together in tonight's night shift, and opened together when it ended."
              : `Written in tonight's night shift. Sealed until ${event?.endsAt ? hhmm(event.endsAt) : "it ends"}, then they all open at once.`}
          </p>
          {shifted === null && <p className="tn-empty">Loading…</p>}
          {shifted?.length === 0 && (
            <p className="tn-empty">
              {phase === "before" ? "The night shift hasn't started yet." : "No pages in the night shift yet."}
            </p>
          )}
          {shifted && shifted.length > 0 && <Pages list={shifted} fresh={fresh} />}
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
      {night && (
        <section className="tn-night" aria-label="Tonight">
          {(event || occasion) && (
            <div className={`tn-occ${occasion ? ` tn-occ-${occasion.key}` : ""}`}>
              <p className="tn-occ-t">
                <span className="tn-occ-k">Tonight</span>
                <b>{event?.title ?? occasion?.title}</b>
                {event?.startsAt && (
                  <span className="tn-occ-time">
                    {hhmm(event.startsAt)}
                    {event.endsAt ? `–${hhmm(event.endsAt)}` : ""}
                  </span>
                )}
              </p>
              {(event?.body || (!event && occasion)) && <p className="tn-occ-line">{event?.body || occasion?.line}</p>}
              {event?.shift && phase && (
                <p className="tn-occ-acts">
                  {phase === "before" && event.startsAt && <span>starts in {until(event.startsAt, now)}</span>}
                  {phase === "during" && (
                    <>
                      {me ? (
                        <button type="button" className="btn" onClick={joinShift}>
                          Write with everyone
                        </button>
                      ) : (
                        <a className="btn" href="/welcome?start=register">
                          Write with everyone
                        </a>
                      )}
                      <span>{event.endsAt && `${until(event.endsAt, now)} left`}</span>
                    </>
                  )}
                  {phase !== "before" && (
                    <button type="button" className="linkish" onClick={() => setTab("shift")}>
                      {phase === "after" ? "read the night shift" : "who's writing"}
                      {shifted?.length ? ` (${shifted.length})` : ""}
                    </button>
                  )}
                </p>
              )}
            </div>
          )}
          <p className="tn-q-k">Tonight&apos;s question</p>
          <p className="tn-q">{question}</p>
          <div className="tn-q-acts">
            {me ? (
              <button type="button" className="btn" onClick={answer}>
                Answer it
              </button>
            ) : (
              <a className="btn" href="/welcome?start=register">
                Answer it
              </a>
            )}
            <button type="button" className="linkish" onClick={() => setTab("question")}>
              {answers?.length ? `read ${answers.length} ${answers.length === 1 ? "answer" : "answers"}` : "answers"}
            </button>
            <span className="tn-q-sep" aria-hidden="true">
              ·
            </span>
            <button type="button" className="linkish" onClick={() => void turnPage()} disabled={turning}>
              {awake ? "ask Ink for a random page" : "turn to a random page"}
            </button>
          </div>
          {skyLine(sky) && (
            <p className="tn-sky">
              <i
                style={{ background: sky?.tones[0] ? TONES[sky.tones[0].tone].color : undefined }}
                aria-hidden="true"
              />
              {skyLine(sky)}
            </p>
          )}
          {tomorrow && (
            <p className="tn-tomorrow">
              Tomorrow night: <b>{tomorrow.title}</b>
              {"startsAt" in tomorrow && tomorrow.startsAt ? `, ${hhmm(tomorrow.startsAt)}` : ""}
            </p>
          )}
        </section>
      )}
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
        <button
          type="button"
          role="tab"
          className="wr-tab"
          id="tn-tab-question"
          aria-selected={tab === "question"}
          aria-controls="tn-panel"
          onClick={() => setTab("question")}
        >
          Answers{answers?.length ? ` (${answers.length})` : ""}
        </button>
        {shiftId && phase !== "before" && (
          <button
            type="button"
            role="tab"
            className="wr-tab"
            id="tn-tab-shift"
            aria-selected={tab === "shift"}
            aria-controls="tn-panel"
            onClick={() => setTab("shift")}
          >
            Night shift{shifted?.length ? ` (${shifted.length})` : ""}
          </button>
        )}
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
