"use client";

import {
  type Entry,
  type EntrySummary,
  type Inline,
  type Me,
  type MyReactions,
  type Note,
  type Profile,
  parseBody,
  type ReactionKind,
} from "@4me/shared";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { API_URL, apiSend, count, hhmm, longDate } from "@/lib/api";
import { claimAudio, releaseAudio, useOtherAudio } from "@/lib/clip";
import { useLiveEvent } from "@/lib/live";
import { myReactions, reactAsMember } from "@/lib/member-actions";
import { reportAsMember } from "@/lib/writer-actions";
import { Comments } from "../Comments";
import { DeskLink } from "../DeskLink";
import { Eq, IconPause, IconPlay } from "../Icons";
import { useNightQuestion } from "../night/plan";
import { ReactionBar, shift } from "../Reactions";
import { Report } from "../Report";
import { Subscribe } from "../Subscribe";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "strike" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <s key={i}>{p.text}</s>
        ) : p.kind === "em" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <em key={i}>{p.text}</em>
        ) : p.kind === "link" ? (
          // A writer's link leaves the diary in a new tab, and passes on nothing about the reader.
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <a key={i} href={p.href} target="_blank" rel="nofollow ugc noopener noreferrer">
            {p.text}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const TILTS = ["-4deg", "5deg", "-2deg", "3deg"];

/** Scrolls inside the diary window to its notes: scrolling the page would move the whole desktop. */
function toNotes() {
  const notes = document.getElementById("notes");
  const box = notes?.closest<HTMLElement>(".body");
  if (!notes || !box) return;
  // Larger text zooms the window's body; its scroll offsets are in its own (zoomed) units.
  const zoom = Number.parseFloat(getComputedStyle(box).zoom) || 1;
  if (box.scrollHeight <= box.clientHeight) return notes.scrollIntoView({ behavior: "smooth", block: "start" });
  box.scrollTo({
    top: box.scrollTop + (notes.getBoundingClientRect().top - box.getBoundingClientRect().top) / zoom - 12,
    behavior: "smooth",
  });
}

/**
 * A small button that stays at the bottom of the window while the reader is still in the page, and takes them to
 * its notes; it goes once the notes are in view.
 */
function NotesPill({ count }: { count: number }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const notes = document.getElementById("notes");
    if (!notes) return;
    // The window's body scrolls on a computer; on a phone the whole page does.
    const box = notes.closest<HTMLElement>(".body");
    const scroller = box && box.scrollHeight > box.clientHeight ? box : null;
    const seen = new IntersectionObserver(
      ([e]) => setAway(Boolean(e && !e.isIntersecting && e.boundingClientRect.top > 0)),
      { root: scroller, threshold: 0 },
    );
    seen.observe(notes);
    return () => seen.disconnect();
  }, []);
  // A dock of no height: the button comes and goes without moving the page under the reader.
  return (
    <div className="d-notes-dock">
      {away && (
        <button type="button" className="d-notes-pill" onClick={toNotes}>
          {count === 0 ? "Leave the first note" : `Notes (${count})`} ↓
        </button>
      )}
    </div>
  );
}

/** The song ticket plays the page's 30-second preview, the way a song sticker does. */
function useClip(url: string | null | undefined) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // A new page brings a new song: stop the old one.
  useEffect(() => {
    if (!url) return;
    return () => {
      audio.current?.pause();
      audio.current = null;
      setPlaying(false);
    };
  }, [url]);
  useOtherAudio(
    "ticket",
    useCallback(() => {
      audio.current?.pause();
      setPlaying(false);
      releaseAudio("ticket");
    }, []),
  );
  const toggle = () => {
    if (!url) return false;
    audio.current ??= new Audio(url);
    const a = audio.current;
    a.onended = () => {
      setPlaying(false);
      releaseAudio("ticket");
    };
    if (playing) {
      a.pause();
      setPlaying(false);
      releaseAudio("ticket");
    } else {
      claimAudio("ticket");
      void a.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
    return true;
  };
  return { playing, toggle };
}

/** Days, hours, minutes and seconds until a moment, as a ticking line: "41 days 03:12:09". */
function useCountdown(until: string) {
  // Unknown until the page runs in the browser, so the server and the browser draw the same thing first.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (now === null) return { done: false, text: "··:··:··" };
  const left = Math.max(0, new Date(until).getTime() - now);
  const s = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(s / 86400);
  const clock = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return { done: left === 0, text: days > 0 ? `${days} ${days === 1 ? "day" : "days"} ${clock}` : clock };
}

/**
 * A sealed letter: an envelope with a wax seal and a countdown. When the moment comes, the opened page is fetched
 * straight from the API (the cached copy of this page may still say "sealed" for a little while).
 */
function Sealed({
  entry,
  own,
  onEdit,
  onOpen,
}: {
  entry: Entry;
  own: boolean;
  onEdit: () => void;
  onOpen: (e: Entry) => void;
}) {
  const left = useCountdown(entry.sealedUntil!);
  useEffect(() => {
    if (!left.done) return;
    let tries = 0;
    const url = `${API_URL}/entries/by/${encodeURIComponent(entry.author.handle)}/${encodeURIComponent(entry.slug)}`;
    const look = () =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Entry>) : null))
        .then((fresh) => {
          if (fresh && !fresh.sealedUntil) onOpen(fresh);
          else if (++tries < 10) t = window.setTimeout(look, 3000);
        })
        .catch(() => undefined);
    let t = window.setTimeout(look, 500);
    return () => window.clearTimeout(t);
  }, [left.done, entry.author.handle, entry.slug, onOpen]);
  return (
    <div className="body paper sealed">
      <div className="d-by">
        <DeskLink href={`/u/${entry.author.handle}`} className="d-author">
          <img src={entry.author.avatar} alt="" width={28} height={28} />
          {entry.author.name}
        </DeskLink>
        {own ? (
          <button type="button" className="btn" onClick={onEdit}>
            Read or change it
          </button>
        ) : (
          <Subscribe author={entry.author} />
        )}
      </div>
      <div className="envelope" role="img" aria-label="A sealed envelope">
        <span className="flap" />
        <span className="wax">4</span>
      </div>
      <p className="d-note">a letter to the future</p>
      <h1 className="d-title">{entry.title}</h1>
      <p className="seal-when">
        Written {longDate(entry.writtenAt)}. Opens {longDate(entry.sealedUntil!)} at {hhmm(entry.sealedUntil!)}.
      </p>
      <p className="seal-count" aria-live="off">
        {left.done ? "opening…" : left.text}
      </p>
      <p className="seal-why">
        {own
          ? "Only you can read it until then. Your subscribers will be told the moment it opens."
          : `Until then, only ${entry.author.name} can read it. Subscribe to be told the moment it opens.`}
      </p>
    </div>
  );
}

type Props = {
  entry: Entry | null;
  entries: EntrySummary[];
  notes: Note[];
  owner: Profile | null;
  awake: boolean;
  me: Me | null;
  onEdit: (id: number) => void;
  onPhoto: (url: string) => void;
  onSong: () => void;
  onGuestbook: () => void;
  /** Opens the archive gathered by this mood. */
  onMood: (mood: string) => void;
};

/** The page's own reactions: counts for everyone, the reader's own choice, kept live. */
function useEntryReactions(entry: Entry | null, me: Me | null) {
  const [counts, setCounts] = useState(entry?.reactions ?? {});
  const [mine, setMine] = useState<ReactionKind | null>(null);
  useEffect(() => {
    if (!entry) return;
    let live = true;
    const load: Promise<MyReactions> = me
      ? myReactions(entry.id)
      : fetch(`${API_URL}/entries/${entry.id}/reactions/mine`)
          .then((r) => (r.ok ? r.json() : { entry: null, notes: {} }))
          .catch(() => ({ entry: null, notes: {} }));
    void load.then((m) => live && setMine(m.entry));
    return () => {
      live = false;
    };
  }, [entry, me]);
  useLiveEvent((e) => {
    if (e.type === "reactions" && e.target === "entry" && e.targetId === entry?.id) setCounts(e.reactions);
  });
  const pick = async (kind: ReactionKind | null) => {
    if (!entry) return;
    setCounts((c) => shift(c, mine, kind));
    setMine(kind);
    const res = me
      ? await reactAsMember("entry", entry.id, kind)
      : await apiSend<{ reactions: Entry["reactions"] }>(`/entries/${entry.id}/react`, { kind }).then((r) =>
          r.ok ? { ok: true as const, ...r.data } : { ok: false as const },
        );
    if (res.ok) setCounts(res.reactions);
  };
  return { counts, mine, pick };
}

export function Diary(props: Props) {
  // A sealed letter that opens while it is on screen is swapped for its opened self.
  const [opened, setOpened] = useState<Entry | null>(null);
  const entry = opened ?? props.entry;
  return <DiaryPage {...props} entry={entry} onOpened={setOpened} />;
}

function DiaryPage({
  entry,
  entries,
  notes,
  owner,
  awake,
  me,
  onEdit,
  onPhoto,
  onSong,
  onGuestbook,
  onMood,
  onOpened,
}: Props & { onOpened: (e: Entry) => void }) {
  const clip = useClip(entry?.song?.previewUrl);
  const feelings = useEntryReactions(entry, me);
  const asked = useNightQuestion(entry?.prompt ?? null);
  if (!entry) {
    const mine = owner && me?.handle === owner.handle;
    return (
      <div className="body paper">
        <p className="d-note">nothing written yet.</p>
        <p style={{ marginTop: 12 }}>
          {owner
            ? mine
              ? "Your desktop is ready. Open Write to post your first night."
              : `${owner.name} hasn't written a page yet.`
            : "The front page belongs to everyone, so no one page is open here. Pick a night from Tonight to read it."}
        </p>
      </div>
    );
  }
  const own = me?.handle === entry.author.handle;
  const link = (e: EntrySummary) => `/u/${e.author.handle}/${e.slug}`;
  if (entry.sealedUntil) return <Sealed entry={entry} own={own} onEdit={() => onEdit(entry.id)} onOpen={onOpened} />;
  const idx = entries.findIndex((e) => e.slug === entry.slug);
  const older = idx >= 0 ? entries[idx + 1] : entries[0];
  const newer = idx > 0 ? entries[idx - 1] : undefined;
  const blocks = parseBody(entry.body);
  const inlinePhotos = new Set(blocks.flatMap((b) => (b.kind === "photo" ? [b.index] : [])));
  const sidePhotos = entry.photos.filter((_, i) => !inlinePhotos.has(i)).slice(0, 3);

  return (
    <div className="body paper">
      {!awake && (
        <div className="asleep-box">
          <span className="d-note">shh. the diaries are asleep.</span>
          They wake up after 5 pm. Until then, here is the last night&apos;s page. The guestbook is always open, and so
          is Ink.
        </div>
      )}
      <div className="d-by">
        <DeskLink href={`/u/${entry.author.handle}`} className="d-author">
          <img src={entry.author.avatar} alt="" width={28} height={28} />
          {entry.author.name}
        </DeskLink>
        {own ? (
          <button type="button" className="btn" onClick={() => onEdit(entry.id)}>
            Edit this page
          </button>
        ) : (
          <Subscribe author={entry.author} />
        )}
      </div>
      <span className="d-date">
        {longDate(entry.writtenAt)} <span className="d-time">— {hhmm(entry.writtenAt)}</span>
      </span>
      {entry.prompt && (
        <p className="d-prompt">
          <span>answering that night&apos;s question</span> {asked}
        </p>
      )}
      <h1 className="d-title">{entry.title}</h1>
      <div className="d-cur">
        {entry.mood && (
          <span>
            Current mood:{" "}
            <button
              type="button"
              className="d-mood"
              title={`Every night that felt “${entry.mood}”`}
              onClick={() => onMood(entry.mood)}
            >
              {entry.mood}
            </button>
          </span>
        )}
        {entry.weather && (
          <span>
            Weather: <b>{entry.weather}</b>
          </span>
        )}
        <span>
          Read <b>{entry.readCount.toLocaleString("en")}</b> {entry.readCount === 1 ? "time" : "times"}
        </span>
      </div>
      <div className="d-grid">
        <div className="d-text">
          {blocks.map((b, i) => {
            const key = `${b.kind}-${i}`;
            if (b.kind === "note")
              return (
                <p key={key} className="d-note">
                  {b.text}
                </p>
              );
            if (b.kind === "quote")
              return (
                <figure key={key} className="d-quote">
                  <blockquote>
                    {b.lines.map((line, n) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines never reorder
                      <span key={n}>
                        <Inlines parts={line} />
                      </span>
                    ))}
                  </blockquote>
                  {b.cite && <figcaption>{b.cite}</figcaption>}
                </figure>
              );
            if (b.kind === "photo") {
              const ph = entry.photos[b.index];
              return ph ? (
                <button key={key} type="button" className="pol d-inline-photo" onClick={() => onPhoto(ph.url)}>
                  <img
                    src={ph.url}
                    alt={ph.caption || "photo from this night"}
                    width={600}
                    height={600}
                    loading="lazy"
                  />
                  <span>{ph.caption}</span>
                </button>
              ) : null;
            }
            return (
              <p key={key}>
                <Inlines parts={b.parts} />
              </p>
            );
          })}
        </div>
        <div className="d-side">
          {sidePhotos.map((ph, i) => (
            <button
              key={ph.url}
              type="button"
              className="pol"
              style={{ "--tilt": TILTS[i % TILTS.length] } as CSSProperties}
              onClick={() => onPhoto(ph.url)}
              aria-label={`Open photo: ${ph.caption || "from this night"}`}
            >
              <img src={ph.url} alt={ph.caption || "photo from this night"} width={600} height={600} loading="lazy" />
              <span>{ph.caption}</span>
            </button>
          ))}
          {entry.song && (
            <button
              type="button"
              className="ticket"
              onClick={() => clip.toggle() || onSong()}
              aria-label={
                entry.song.previewUrl
                  ? `${clip.playing ? "Stop" : "Play"} 30 seconds of ${entry.song.title} by ${entry.song.artist}`
                  : `${entry.song.title} by ${entry.song.artist}: open the mixtape`
              }
            >
              {entry.song.coverUrl ? (
                <img className="ticket-cover" src={entry.song.coverUrl} alt="" width={44} height={44} />
              ) : (
                <Eq />
              )}
              <span>
                <small>ON REPEAT</small>
                <b>{entry.song.title}</b>
                <i>{entry.song.artist}</i>
              </span>
              {entry.song.previewUrl && (
                <span className="ticket-play" aria-hidden="true">
                  {clip.playing ? <IconPause /> : <IconPlay />}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="d-feel">
        <ReactionBar
          counts={feelings.counts}
          mine={feelings.mine}
          onPick={(k) => void feelings.pick(k)}
          label="this page"
        />
      </div>
      <div className="d-foot">
        <span>{older && <DeskLink href={link(older)}>« {older.title}</DeskLink>}</span>
        <span>
          <button type="button" className="linkish" onClick={toNotes}>
            {count(entry.noteCount, "note")}
          </button>{" "}
          ·{" "}
          <button type="button" className="linkish" onClick={onGuestbook}>
            sign the guestbook
          </button>
          {!own && (
            <>
              {" "}
              ·{" "}
              <Report
                key={entry.id}
                me={me}
                what="page"
                send={(reason, turnstileToken) =>
                  me
                    ? reportAsMember(entry.id, reason)
                    : apiSend(`/entries/${entry.id}/report`, { reason, turnstileToken })
                }
              />
            </>
          )}
          {newer && (
            <>
              {" "}
              · <DeskLink href={link(newer)}>{newer.title} »</DeskLink>
            </>
          )}
        </span>
      </div>
      <NotesPill key={`pill-${entry.id}`} count={entry.noteCount} />
      <Comments key={entry.id} entry={entry} initial={notes} me={me} />
    </div>
  );
}
