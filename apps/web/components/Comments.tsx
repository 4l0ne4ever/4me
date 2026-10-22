"use client";

import { avatarUrl, type Entry, type Me, type MyReactions, type Note, type ReactionKind } from "@4me/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL, apiSend, hhmm, shortDate } from "@/lib/api";
import { useFresh, useLiveEvent } from "@/lib/live";
import {
  banFromDiary,
  deleteNote,
  editNote,
  myReactions,
  noteAsMember,
  reactAsMember,
  reportNoteAsMember,
} from "@/lib/member-actions";
import { DeskLink } from "./DeskLink";
import { useConfirm } from "./Dialog";
import { nudgeInk } from "./ink/Ink";
import { ReactionBar, shift } from "./Reactions";
import { Report } from "./Report";
import type { PickedSong } from "./SongPicker";
import { AddSong, SongSticker, toPick } from "./SongSticker";
import { useTurnstile } from "./Turnstile";

const when = (iso: string) => `${shortDate(iso)}, ${hhmm(iso)}`;

/** One box to write in: a note on the page, or a reply when `parentId` is set. */
function Composer({
  entry,
  me,
  parentId,
  replyTo,
  onSent,
  onCancel,
}: {
  entry: Entry;
  me: Me | null;
  parentId?: number;
  replyTo?: string;
  onSent: (note: Note, pending: boolean) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [song, setSong] = useState<PickedSong | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const human = useTurnstile();
  const id = `c-${parentId ?? "new"}`;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const res = me
      ? await noteAsMember(entry.id, text, parentId, toPick(song)).then((r) =>
          r.ok ? { ok: true as const, data: r } : { ok: false as const, error: r.error },
        )
      : await apiSend<{ note: Note; pending: boolean }>(`/entries/${entry.id}/notes`, {
          name,
          body: text,
          parentId,
          song: toPick(song),
          turnstileToken: human.token,
        });
    setBusy(false);
    if (!me) human.reset();
    if (!res.ok) return setMsg(res.error);
    setText("");
    setSong(null);
    if (res.data.pending) setMsg(`Thanks. Notes with links wait for ${entry.author.name} to read them first.`);
    onSent(res.data.note, res.data.pending);
    nudgeInk("note");
  };

  return (
    <form className={`cm-compose${parentId ? " reply" : ""}`} onSubmit={send}>
      {me ? (
        <img className="cm-av" src={avatarUrl(me.avatar)} alt="" width={32} height={32} />
      ) : (
        <span className="cm-av cm-guest" aria-hidden="true">
          ?
        </span>
      )}
      <div className="cm-fields">
        {!me && (
          <>
            <label htmlFor={`${id}-name`} className="sr">
              Your name
            </label>
            <input
              id={`${id}-name`}
              className="field"
              placeholder="your name (optional)"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
        <label htmlFor={`${id}-text`} className="sr">
          {replyTo ? `Reply to ${replyTo}` : "Leave a note on this page"}
        </label>
        <textarea
          id={`${id}-text`}
          className="field"
          rows={parentId ? 2 : 3}
          maxLength={500}
          placeholder={replyTo ? `reply to ${replyTo}…` : "leave a note…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: a reply box opens because the reader asked to reply
          autoFocus={Boolean(parentId)}
        />
        <AddSong value={song} onChange={setSong} />
        {!me && human.widget}
        {msg && (
          <p className="cm-msg" role="status">
            {msg}
          </p>
        )}
        <div className="cm-row">
          <button
            className="btn"
            type="submit"
            disabled={busy || !text.trim() || (!me && human.needed && !human.token)}
          >
            {parentId ? "Reply" : "Post note"}
          </button>
          {onCancel && (
            <button type="button" className="linkish" onClick={onCancel}>
              cancel
            </button>
          )}
          {!me && !parentId && (
            <small>
              Writing as a guest. <a href="/welcome">Log on</a> to keep your name.
            </small>
          )}
        </div>
      </div>
    </form>
  );
}

/** One note: who, when, what, its reactions, and reply / edit / delete / report. */
function NoteItem({
  note,
  me,
  canDelete,
  canBan,
  mine,
  onReact,
  onReply,
  onDelete,
  onBan,
  onEdited,
}: {
  note: Note;
  me: Me | null;
  canDelete: boolean;
  /** The page's writer, on someone else's note: they may keep its writer off their diary. */
  canBan: boolean;
  onBan: () => void;
  mine: ReactionKind | null;
  onReact: (kind: ReactionKind | null) => void;
  onReply: () => void;
  onDelete: () => void;
  onEdited: (note: Note, pending: boolean) => void;
}) {
  const own = Boolean(me && note.member?.handle === me.handle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = await editNote(note.id, draft);
    if (!res.ok) return setError(res.error);
    setEditing(false);
    setError(null);
    onEdited(res.note, res.pending);
  };

  return (
    <article className={`cm${note.isAuthor ? " by-author" : ""}`} id={`note-${note.id}`}>
      <img className="cm-av" src={note.member?.avatar ?? avatarUrl(null)} alt="" width={32} height={32} />
      <div className="cm-main">
        <header>
          {note.member ? <DeskLink href={`/u/${note.member.handle}`}>{note.name}</DeskLink> : <b>{note.name}</b>}
          {note.isAuthor && <span className="cm-badge">writer</span>}
          <time dateTime={note.createdAt}>{when(note.createdAt)}</time>
          {note.editedAt && <span className="cm-edited">edited</span>}
        </header>
        {editing ? (
          <form className="cm-edit" onSubmit={save}>
            <label htmlFor={`edit-${note.id}`} className="sr">
              Edit your note
            </label>
            <textarea
              id={`edit-${note.id}`}
              className="field"
              rows={2}
              maxLength={500}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the reader asked to edit this note
              autoFocus
            />
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <div className="cm-row">
              <button className="btn" type="submit" disabled={!draft.trim() || draft === note.body}>
                Save
              </button>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setEditing(false);
                  setDraft(note.body);
                }}
              >
                cancel
              </button>
            </div>
          </form>
        ) : (
          <p>{note.body}</p>
        )}
        {note.song && !editing && <SongSticker song={note.song} />}
        <div className="cm-acts">
          <ReactionBar small counts={note.reactions} mine={mine} onPick={onReact} label={`${note.name}'s note`} />
          <button type="button" className="linkish" onClick={onReply}>
            reply
          </button>
          {own && !editing && (
            <button type="button" className="linkish" onClick={() => setEditing(true)}>
              edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="linkish" onClick={onDelete}>
              delete
            </button>
          )}
          {canBan && (
            <button type="button" className="linkish" onClick={onBan}>
              block
            </button>
          )}
          {!own && (
            <Report
              me={me}
              what="note"
              send={(reason, turnstileToken) =>
                me
                  ? reportNoteAsMember(note.id, reason)
                  : apiSend(`/entries/notes/${note.id}/report`, { reason, turnstileToken })
              }
            />
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The notes under a page, with replies one level deep (replying to a reply answers the same thread), reactions on
 * each, and delete for the note's writer or the page's writer. Everything arrives live from other readers.
 */
export function Comments({ entry, initial, me }: { entry: Entry; initial: Note[]; me: Me | null }) {
  const [notes, setNotes] = useState(initial);
  const confirm = useConfirm();
  const [mine, setMine] = useState<MyReactions>({ entry: null, notes: {} });
  const [replying, setReplying] = useState<number | null>(null);
  const isOwner = me?.handle === entry.author.handle;

  useEffect(() => {
    let live = true;
    const load = me
      ? myReactions(entry.id)
      : fetch(`${API_URL}/entries/${entry.id}/reactions/mine`)
          .then((r) => (r.ok ? (r.json() as Promise<MyReactions>) : { entry: null, notes: {} }))
          .catch(() => ({ entry: null, notes: {} }));
    void load.then((m) => live && setMine((cur) => ({ ...m, entry: cur.entry ?? m.entry })));
    return () => {
      live = false;
    };
  }, [entry.id, me]);

  // A note can come back from the server and live at once, or be edited: it shows once, newest version.
  useFresh<Note[]>(entry.sealedUntil ? null : `${API_URL}/entries/${entry.id}/notes`, setNotes);
  const add = (note: Note) =>
    setNotes((l) => (l.some((x) => x.id === note.id) ? l.map((x) => (x.id === note.id ? note : x)) : [...l, note]));
  useLiveEvent((e) => {
    if (e.type === "note" && e.entryId === entry.id) add(e.note);
    if (e.type === "note-gone" && e.entryId === entry.id)
      setNotes((l) => l.filter((x) => x.id !== e.noteId && x.parentId !== e.noteId));
    if (e.type === "reactions" && e.target === "note" && e.entryId === entry.id)
      setNotes((l) => l.map((x) => (x.id === e.targetId ? { ...x, reactions: e.reactions } : x)));
  });

  const threads = useMemo(() => {
    const ids = new Set(notes.map((n) => n.id));
    const roots = notes.filter((n) => !n.parentId || !ids.has(n.parentId));
    return roots.map((root) => ({ root, replies: notes.filter((n) => n.parentId === root.id) }));
  }, [notes]);

  const reactTo = async (note: Note, kind: ReactionKind | null) => {
    const before = mine.notes[note.id] ?? null;
    setMine((m) => {
      const next = { ...m.notes };
      if (kind) next[note.id] = kind;
      else delete next[note.id];
      return { ...m, notes: next };
    });
    setNotes((l) => l.map((x) => (x.id === note.id ? { ...x, reactions: shift(x.reactions, before, kind) } : x)));
    const res = me
      ? await reactAsMember("note", note.id, kind)
      : await apiSend<{ reactions: Note["reactions"] }>(`/entries/notes/${note.id}/react`, { kind }).then((r) =>
          r.ok ? { ok: true as const, ...r.data } : { ok: false as const },
        );
    if (res.ok) setNotes((l) => l.map((x) => (x.id === note.id ? { ...x, reactions: res.reactions } : x)));
  };

  /** Keeps the note's writer off this diary, and takes the note (and its replies) down. */
  const ban = async (note: Note) => {
    const ok = await confirm({
      title: "Block from your diary",
      text: `Keep ${note.name} off your diary? They won't be able to leave notes on your pages or sign your guestbook${
        note.member ? "" : " (a guest is recognised by their connection, so others on it are kept off too)"
      }. This note is deleted. You can let them back from My account.`,
      ok: "Block and delete",
      danger: true,
    });
    if (!ok) return;
    const res = await banFromDiary({ noteId: note.id }, true);
    if (res.ok) setNotes((l) => l.filter((x) => x.id !== note.id && x.parentId !== note.id));
  };

  const remove = async (note: Note) => {
    const ok = await confirm({
      title: "Delete note",
      text: "Delete this note, and every reply under it? This can't be undone.",
      ok: "Delete",
      danger: true,
    });
    if (!ok) return;
    const res = await deleteNote(note.id);
    if (res.ok) setNotes((l) => l.filter((x) => x.id !== note.id && x.parentId !== note.id));
  };

  const item = (note: Note, threadId: number) => (
    <NoteItem
      key={note.id}
      note={note}
      me={me}
      onEdited={(next, pending) => (pending ? setNotes((l) => l.filter((x) => x.id !== next.id)) : add(next))}
      canDelete={Boolean(me && (note.member?.handle === me.handle || isOwner))}
      canBan={isOwner && note.member?.handle !== me?.handle && !note.isAuthor}
      onBan={() => void ban(note)}
      mine={mine.notes[note.id] ?? null}
      onReact={(k) => void reactTo(note, k)}
      onReply={() => setReplying(threadId)}
      onDelete={() => void remove(note)}
    />
  );

  return (
    <section className="cms" id="notes" aria-labelledby="notes-h">
      <h2 id="notes-h">
        {notes.length === 0 ? "No notes yet" : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
      </h2>
      <p className="cm-hint">Answers to this page, for everyone who reads it. No account needed.</p>
      {threads.map(({ root, replies }) => (
        <div className="cm-thread" key={root.id}>
          {item(root, root.id)}
          {(replies.length > 0 || replying === root.id) && (
            <div className="cm-replies">
              {replies.map((r) => item(r, root.id))}
              {replying === root.id && (
                <Composer
                  entry={entry}
                  me={me}
                  parentId={root.id}
                  replyTo={root.name}
                  onSent={(note, pending) => {
                    if (!pending) add(note);
                    setReplying(null);
                  }}
                  onCancel={() => setReplying(null)}
                />
              )}
            </div>
          )}
        </div>
      ))}
      <Composer entry={entry} me={me} onSent={(note, pending) => !pending && add(note)} />
    </section>
  );
}
