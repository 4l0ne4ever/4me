"use client";

import { useEffect, useState } from "react";
import { hhmm } from "@/lib/api";
import { useDesk } from "../DeskShell";
import { type ShiftPhase, shiftPhase, until } from "./plan";

const seen = (key: string) => {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
};
const remember = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // it may show again; harmless
  }
};

/** Minutes to midnight in Vietnam, for the last night of the year. */
function toMidnight(now: number): string | null {
  const vn = new Date(now + 7 * 3600_000);
  const h = vn.getUTCHours();
  if (h < 12) return null;
  const left = (24 * 60 - (h * 60 + vn.getUTCMinutes())) * 60_000;
  return until(new Date(now + left).toISOString(), now);
}

/**
 * On the nights that are not like the others (and only then), a note pinned to the desktop: what is on tonight and
 * when, and the one thing to do about it. A night shift also says so by the clock when it starts and when its pages
 * open. Unpinned, it stays away for the rest of the night; Tonight still has it.
 */
export function NightNotice() {
  const { night, plan, occasion, me, joinShift, readShift, answer, open } = useDesk();
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(true);
  const [balloon, setBalloon] = useState<ShiftPhase | null>(null);
  const event = plan?.event ?? null;
  const phase = shiftPhase(event, now);
  const noteKey = night ? `4me-notice-${night}${event ? `-${event.id}` : ""}` : null;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setHidden(noteKey ? seen(noteKey) : true);
  }, [noteKey]);

  // By the clock, once each: the shift has started; the shift's pages are open (within a few hours of it ending).
  useEffect(() => {
    if (!event || (phase !== "during" && phase !== "after")) return;
    if (phase === "after" && now - Date.parse(event.endsAt!) > 3 * 3600_000) return;
    const key = `4me-shift-${event.id}-${phase}`;
    if (seen(key)) return;
    remember(key);
    setBalloon(phase);
  }, [event, phase, now]);

  if (!night || !(event || occasion)) return null;
  const title = event?.title ?? occasion!.title;
  const line = event ? event.body : occasion!.line;
  const countdown = !event && occasion?.key === "newyear" ? toMidnight(now) : null;

  return (
    <>
      {!hidden && (
        <aside className={`notice${occasion ? ` notice-${occasion.key}` : ""}`} aria-label="Tonight on 4me">
          <span className="notice-pin" aria-hidden="true" />
          <button
            type="button"
            className="notice-x"
            aria-label="Unpin for tonight"
            title="Unpin for tonight"
            onClick={() => {
              if (noteKey) remember(noteKey);
              setHidden(true);
            }}
          >
            ×
          </button>
          <p className="notice-k">tonight</p>
          <h2 className="notice-t">{title}</h2>
          {event?.startsAt && (
            <p className="notice-time">
              {hhmm(event.startsAt)}
              {event.endsAt ? ` – ${hhmm(event.endsAt)}` : ""}
              {phase === "before" && ` · in ${until(event.startsAt, now)}`}
              {phase === "during" && event.endsAt && ` · ${until(event.endsAt, now)} left`}
              {phase === "after" && " · over, the pages are open"}
            </p>
          )}
          {line && <p className="notice-line">{line}</p>}
          {countdown && <p className="notice-time">{countdown} to the new year</p>}
          <div className="notice-acts">
            {phase === "during" ? (
              me ? (
                <button type="button" className="btn" onClick={joinShift}>
                  Write with everyone
                </button>
              ) : (
                <a className="btn" href="/welcome?start=register">
                  Write with everyone
                </a>
              )
            ) : phase === "after" ? (
              <button type="button" className="btn" onClick={readShift}>
                Read the night shift
              </button>
            ) : event?.question || (!event && occasion) ? (
              me ? (
                <button type="button" className="btn" onClick={answer}>
                  Answer tonight&apos;s question
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => open("tonight")}>
                  Tonight&apos;s question
                </button>
              )
            ) : null}
            <button type="button" className="linkish" onClick={() => open("poem")}>
              add a line to the poem
            </button>
          </div>
        </aside>
      )}
      {balloon && event && (
        <div className="balloon shift-balloon" role="status">
          <button
            type="button"
            className="balloon-body"
            onClick={() => {
              setBalloon(null);
              if (balloon === "after") readShift();
              else if (me) joinShift();
              else open("tonight");
            }}
          >
            <span className="shift-lamp" aria-hidden="true" />
            <span>
              {balloon === "during" ? (
                <>
                  <b>{event.title} has started</b>
                  Write until {hhmm(event.endsAt!)}. Every page stays sealed till then, and they all open together.
                </>
              ) : (
                <>
                  <b>The {event.title.toLowerCase()} is over</b>
                  Its pages have opened, all at once. Read what everyone wrote?
                </>
              )}
            </span>
          </button>
          <button type="button" className="balloon-x" aria-label="Close" onClick={() => setBalloon(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
