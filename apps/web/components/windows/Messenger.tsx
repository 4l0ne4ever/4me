"use client";

import { type Author, avatarUrl, type Blast, type Entry, type Me, type Note, type NowPlaying } from "@4me/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiSend, hhmm, shortDate } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { noteAsMember } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";
import { Eq } from "../Icons";
import { nudgeInk } from "../ink/Ink";
import { useTurnstile } from "../Turnstile";

type Line = { kind: "note"; note: Note } | { kind: "sys"; text: string; at: string; buzz?: boolean };

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hours ago` : shortDate(iso);
}

let audio: AudioContext | null = null;
function buzzSound() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "square";
    o.frequency.value = 95;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    for (let k = 0; k < 4; k++) {
      g.gain.setValueAtTime(0.05, audio.currentTime + k * 0.12);
      g.gain.setValueAtTime(0.0001, audio.currentTime + k * 0.12 + 0.07);
    }
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.5);
  } catch {
    // no sound, no problem
  }
}

type Props = {
  entry: Entry | null;
  /** Whose Messenger this is: the desktop's owner, or the writer of the page that is open. */
  persona: Author | null;
  notes: Note[];
  blasts: Blast[];
  awake: boolean;
  live: NowPlaying | null;
  onBuzz: () => void;
  me: Me | null;
};

export function Messenger({ entry, persona, notes, blasts, awake, live, onBuzz, me }: Props) {
  const [lines, setLines] = useState<Line[]>(() => notes.map((note) => ({ kind: "note", note })));
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  const human = useTurnstile();
  const [latest, ...older] = blasts;
  const regulars = [...new Set(notes.filter((n) => !n.isAuthor).map((n) => n.name))].slice(-4).reverse();

  // follow new lines as they arrive, but open on the top so the blast is the first thing read
  const seen = useRef(lines.length);
  useEffect(() => {
    if (lines.length > seen.current) chat.current?.parentElement?.scrollTo({ top: 1e6, behavior: "smooth" });
    seen.current = lines.length;
  }, [lines]);

  const add = (line: Line) => setLines((l) => [...l, line]);
  // A note can arrive twice (my own reply, and the live copy of it): it only shows once.
  const addNote = (note: Note) =>
    setLines((l) =>
      l.some((x) => x.kind === "note" && x.note.id === note.id)
        ? l.map((x) => (x.kind === "note" && x.note.id === note.id ? { kind: "note", note } : x))
        : [...l, { kind: "note", note }],
    );
  const [reading, setReading] = useState<number | null>(null);
  const ownBuzz = useRef(0);

  useLiveEvent((e) => {
    if (!entry) return;
    if (e.type === "note" && e.entryId === entry.id) addNote(e.note);
    if (e.type === "note-gone" && e.entryId === entry.id)
      setLines((l) => l.filter((x) => x.kind !== "note" || (x.note.id !== e.noteId && x.note.parentId !== e.noteId)));
    if (e.type === "presence" && e.entryId === entry.id) setReading(e.reading);
    if (e.type === "buzz" && e.entryId === entry.id && Date.now() - ownBuzz.current > 2500) {
      buzzSound();
      nudgeInk("buzz");
      add({ kind: "sys", buzz: true, text: "Someone just sent a BUZZ!!!", at: new Date().toISOString() });
    }
  });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!entry || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    // Members write through the web server under their own name; guests go straight to the API.
    const res = me
      ? await noteAsMember(entry.id, text).then((r) =>
          r.ok
            ? { ok: true as const, data: { note: r.note, pending: r.pending } }
            : { ok: false as const, error: r.error },
        )
      : await apiSend<{ note: Note; pending: boolean }>(`/entries/${entry.id}/notes`, {
          name,
          body: text,
          turnstileToken: human.token,
        });
    setBusy(false);
    if (!me) human.reset();
    if (!res.ok) return setError(res.error);
    setText("");
    if (res.data.pending)
      add({
        kind: "sys",
        text: `your note is waiting for ${entry.author.name} to read it first.`,
        at: new Date().toISOString(),
      });
    else addNote(res.data.note);
    nudgeInk("note");
  };

  const buzz = async () => {
    if (!entry) return;
    ownBuzz.current = Date.now();
    buzzSound();
    onBuzz();
    nudgeInk("buzz");
    const res = await apiSend<{ buzzCount: number }>(`/entries/${entry.id}/buzz`);
    add(
      res.ok
        ? { kind: "sys", buzz: true, text: "You have just sent a BUZZ!!!", at: new Date().toISOString() }
        : { kind: "sys", text: res.error, at: new Date().toISOString() },
    );
  };

  const song = live ?? (entry?.song ? { artist: entry.song.artist, title: entry.song.title, live: false } : null);

  return (
    <>
      <div className="body">
        <div className="me">
          <img
            src={persona?.avatar ?? "/photos/pic-1014.jpg"}
            alt={persona ? `${persona.name}'s picture` : ""}
            width={56}
            height={56}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>
              {persona ? <DeskLink href={`/u/${persona.handle}`}>{persona.name}</DeskLink> : "nobody yet"}{" "}
              {awake ? <span className="on-dot">(online)</span> : <span className="off-dot">(asleep)</span>}
            </b>
            {latest && (
              <div className="blast">
                <q>{latest.body}</q>
                <small>Blast · {ago(latest.createdAt)}</small>
              </div>
            )}
            {song && (
              <span className="np">
                <Eq />
                <span>
                  {song.live ? "now: " : ""}
                  {song.artist} – {song.title}
                </span>
              </span>
            )}
          </div>
        </div>
        {older.length > 0 && (
          <details className="fold">
            <summary>Older blasts</summary>
            <ul>
              {older.map((b) => (
                <li key={b.id}>
                  {b.body} <span>· {shortDate(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {regulars.length > 0 && (
          <details className="fold" open>
            <summary>Recently here ({regulars.length})</summary>
            <ul>
              {regulars.map((r) => (
                <li key={r}>
                  <span className="dot" />
                  {r}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="chat-hd">
          {entry ? `Notes on “${entry.title}”` : "No page yet"}
          {reading !== null && reading > 1 && <span className="reading"> · {reading} reading now</span>}
        </p>
        <div className="chat" ref={chat} aria-live="polite">
          {lines.map((l, i) =>
            l.kind === "note" ? (
              <p className="ln" key={`n${l.note.id}`}>
                <span className="t">({hhmm(l.note.createdAt)})</span>{" "}
                {l.note.parentId && (
                  <span className="t" title="a reply">
                    ↪{" "}
                  </span>
                )}
                {l.note.member && <img className="av" src={l.note.member.avatar} alt="" width={16} height={16} />}
                <span className={`n${l.note.isAuthor ? " own" : ""}`} title={l.note.member ? "member" : undefined}>
                  {l.note.member ? <DeskLink href={`/u/${l.note.member.handle}`}>{l.note.name}</DeskLink> : l.note.name}
                  :
                </span>{" "}
                {l.note.body}
              </p>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: system lines are append-only
              <p className="ln" key={`s${i}`}>
                <span className="t">({hhmm(l.at)})</span> <span className={l.buzz ? "buzz" : "sys"}>{l.text}</span>
              </p>
            ),
          )}
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!me && human.widget}
      {!me && (
        <p className="compose-hint">
          Writing as a guest. <a href="/welcome">Log on</a> to keep your name.
        </p>
      )}
      <form className="compose" onSubmit={send}>
        {me ? (
          <span className="as-me" title={`Writing as ${me.displayName}`}>
            <img src={avatarUrl(me.avatar)} alt="" width={24} height={24} />
            <span className="sr">Writing as {me.displayName}</span>
          </span>
        ) : (
          <>
            <label htmlFor="note-name" className="sr">
              Your name
            </label>
            <input
              id="note-name"
              className="field"
              style={{ flex: "0 0 84px" }}
              placeholder="name"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
        <label htmlFor="note-text" className="sr">
          Leave a note on this page
        </label>
        <input
          id="note-text"
          className="field"
          placeholder="leave a note…"
          maxLength={500}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" type="submit" disabled={busy || !entry || (!me && human.needed && !human.token)}>
          Send
        </button>
        <button
          className="btn buzz"
          type="button"
          onClick={buzz}
          disabled={!entry}
          title={entry ? `Shake ${entry.author.name}'s diary` : "Shake the diary"}
        >
          BUZZ!
        </button>
      </form>
    </>
  );
}
