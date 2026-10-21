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
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { API_URL, apiSend, hhmm, longDate } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { myReactions, reactAsMember } from "@/lib/member-actions";
import { reportAsMember } from "@/lib/writer-actions";
import { Comments } from "../Comments";
import { DeskLink } from "../DeskLink";
import { Eq, IconPause, IconPlay } from "../Icons";
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
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const TILTS = ["-4deg", "5deg", "-2deg", "3deg"];

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
  const toggle = () => {
    if (!url) return false;
    audio.current ??= new Audio(url);
    const a = audio.current;
    a.onended = () => setPlaying(false);
    if (playing) {
      a.pause();
      setPlaying(false);
    } else
      void a.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    return true;
  };
  return { playing, toggle };
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

export function Diary({ entry, entries, notes, owner, awake, me, onEdit, onPhoto, onSong, onGuestbook }: Props) {
  const clip = useClip(entry?.song?.previewUrl);
  const feelings = useEntryReactions(entry, me);
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
            : "The first night will appear here once someone writes it."}
        </p>
      </div>
    );
  }
  const own = me?.handle === entry.author.handle;
  const link = (e: EntrySummary) => `/u/${e.author.handle}/${e.slug}`;
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
        {longDate(entry.writtenAt)} — {hhmm(entry.writtenAt)}
      </span>
      <h1 className="d-title">{entry.title}</h1>
      <div className="d-cur">
        {entry.mood && (
          <span>
            Current mood: <b>{entry.mood}</b>
          </span>
        )}
        {entry.weather && (
          <span>
            Weather: <b>{entry.weather}</b>
          </span>
        )}
        <span>
          Read <b>{entry.readCount}</b> times
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
          <button
            type="button"
            className="linkish"
            onClick={() => {
              // Scroll inside the diary window only; scrolling the page would move the whole desktop.
              const notes = document.getElementById("notes");
              const box = notes?.closest<HTMLElement>(".body");
              if (notes && box)
                box.scrollTo({
                  top: box.scrollTop + notes.getBoundingClientRect().top - box.getBoundingClientRect().top - 12,
                  behavior: "smooth",
                });
            }}
          >
            {entry.noteCount} notes
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
      <Comments key={entry.id} entry={entry} initial={notes} me={me} />
    </div>
  );
}
