"use client";

import type { Almost, Blast, Entry, InboxNote, Me, MyEntry, Visibility } from "@4me/shared";
import { type FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { hhmm, shortDate } from "@/lib/api";
import {
  addAlmost,
  addBlast,
  deleteAlmost,
  deleteBlast,
  deleteEntry,
  moderateNote,
  myAlmost,
  myBlasts,
  myEntries,
  myEntry,
  myInbox,
  saveEntry,
} from "@/lib/writer-actions";
import { DeskLink } from "../DeskLink";
import { type DraftPhoto, PhotoPicker } from "../PhotoPicker";
import { type PickedSong, SongPicker } from "../SongPicker";

type Tab = "page" | "mine" | "bits" | "notes";
type Draft = {
  title: string;
  body: string;
  mood: string;
  weather: string;
  writtenAt: string;
  slug: string;
  visibility: Visibility;
  song: PickedSong | null;
  photos: DraftPhoto[];
};
type Msg = { kind: "ok" | "err"; text: string; field?: string } | null;

const BLANK: Draft = {
  title: "",
  body: "",
  mood: "",
  weather: "",
  writtenAt: "",
  slug: "",
  visibility: "public",
  song: null,
  photos: [],
};

/** "2026-10-20T22:05" in the writer's own time, for a datetime-local field. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromEntry(e: Entry & { songId: number | null }): Draft {
  return {
    title: e.title,
    body: e.body,
    mood: e.mood,
    weather: e.weather,
    writtenAt: toLocalInput(e.writtenAt),
    slug: e.slug,
    visibility: e.visibility,
    song: e.song
      ? {
          id: e.songId,
          title: e.song.title,
          artist: e.song.artist,
          coverUrl: e.song.coverUrl,
          previewUrl: e.song.previewUrl,
          url: e.song.url,
        }
      : null,
    // Only uploaded photos can be saved again; the path is what the API stored.
    photos: e.photos.flatMap((p) => {
      const at = p.url.indexOf("/media/u/");
      return at >= 0 ? [{ path: p.url.slice(at), src: p.url, caption: p.caption }] : [];
    }),
  };
}

/** Unsaved work is kept in this browser while typing, per member and per page, so it survives a closed tab. */
const draftKey = (uid: number, id: number | null) => `4me-draft:${uid}:${id ?? "new"}`;
type Kept = { at: number; draft: Draft };
function readKept(key: string): Kept | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as Kept) : null;
  } catch {
    return null;
  }
}
function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing kept
  }
}

const VIS_LABEL: Record<Visibility, string> = { public: "everyone", private: "only me", draft: "draft" };

function Line({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={msg.kind === "ok" ? "acc-ok" : "err"} role={msg.kind === "ok" ? "status" : "alert"}>
      {msg.text}
    </p>
  );
}

/** Wraps the selected words in the diary's markup, or inserts a marker at the cursor. */
function useMarkup(body: string, setBody: (v: string) => void) {
  const area = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = before, placeholder = "words") => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const picked = body.slice(a, b) || placeholder;
    setBody(`${body.slice(0, a)}${before}${picked}${after}${body.slice(b)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + picked.length);
    });
  };
  return { area, wrap };
}

/** The member's Notepad: write or edit a page, see their pages, blast, bin a line, read notes on their pages. */
export function Write({
  me,
  editing,
  onEditing,
  onSaved,
  onDeleted,
}: {
  me: Me;
  editing: number | null;
  onEditing: (id: number | null) => void;
  onSaved: (entry: Entry) => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<Tab>("page");
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [mine, setMine] = useState<MyEntry[] | null>(null);
  const [blasts, setBlasts] = useState<Blast[] | null>(null);
  const [bin, setBin] = useState<Almost[] | null>(null);
  const [inbox, setInbox] = useState<InboxNote[] | null>(null);
  const [blastText, setBlastText] = useState("");
  const [binText, setBinText] = useState("");
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  /** The page as it was opened; the draft is "unsaved" while it differs from this. */
  const baseline = useRef(JSON.stringify(BLANK));
  const [restorable, setRestorable] = useState<Kept | null>(null);
  const key = draftKey(me.id, editing);

  /** A page was opened: remember it as saved, and offer back any unsaved changes this browser kept for it. */
  const opened = useCallback(
    (d: Draft) => {
      baseline.current = JSON.stringify(d);
      setDraft(d);
      const kept = readKept(draftKey(me.id, editing));
      setRestorable(kept && JSON.stringify(kept.draft) !== baseline.current ? kept : null);
    },
    [me.id, editing],
  );

  /* keep unsaved changes as they are typed (not while an older copy is waiting to be restored or thrown away) */
  useEffect(() => {
    if (loading || restorable) return;
    const now = JSON.stringify(draft);
    const t = window.setTimeout(() => {
      try {
        if (now === baseline.current) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ at: Date.now(), draft } satisfies Kept));
      } catch {
        // storage off: the page still saves normally
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [draft, key, loading, restorable]);
  const markup = useMarkup(draft.body, (body) => set({ body }));

  /* the page being edited, or a blank one (the message stays: "Saved" must survive the reload after saving) */
  useEffect(() => {
    setTab("page");
    if (!editing) {
      opened(BLANK);
      return;
    }
    let live = true;
    setLoading(true);
    void myEntry(editing).then((e) => {
      if (!live) return;
      setLoading(false);
      if (e) opened(fromEntry(e));
      else {
        setMsg({ kind: "err", text: "That page couldn't be opened." });
        onEditing(null);
      }
    });
    return () => {
      live = false;
    };
  }, [editing, onEditing, opened]);

  const loadTab = useCallback((t: Tab) => {
    if (t === "mine") void myEntries().then(setMine);
    if (t === "bits") {
      void myBlasts().then(setBlasts);
      void myAlmost().then(setBin);
    }
    if (t === "notes") void myInbox().then(setInbox);
  }, []);

  useEffect(() => {
    loadTab(tab);
  }, [tab, loadTab]);

  const waiting = inbox?.filter((n) => n.status === "pending").length ?? 0;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await saveEntry(editing, {
        title: draft.title,
        body: draft.body,
        mood: draft.mood,
        weather: draft.weather,
        writtenAt: draft.writtenAt ? new Date(draft.writtenAt).toISOString() : undefined,
        slug: draft.slug || undefined,
        visibility: draft.visibility,
        // An older song that was not picked from the search stays as it is.
        song: draft.song
          ? draft.song.id
            ? {
                id: draft.song.id,
                title: draft.song.title,
                artist: draft.song.artist,
                coverUrl: draft.song.coverUrl,
                previewUrl: draft.song.previewUrl,
                url: draft.song.url,
              }
            : undefined
          : null,
        photos: draft.photos.map((p) => ({ url: p.path, caption: p.caption })),
      });
      if (!res.ok) return setMsg({ kind: "err", text: res.error, field: res.field });
      setMsg({
        kind: "ok",
        text: res.entry.visibility === "public" ? "Posted. Opening your page…" : "Saved. Only you can see it.",
      });
      forget(key);
      baseline.current = JSON.stringify(draft);
      onEditing(res.entry.id);
      if (res.entry.visibility === "public") onSaved(res.entry);
    });
  };

  const remove = (id: number, title: string) => {
    if (!window.confirm(`Delete “${title}” and its photos? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteEntry(id);
      if (!res.ok) return setMsg({ kind: "err", text: res.error });
      setMine((m) => m?.filter((x) => x.id !== id) ?? null);
      forget(draftKey(me.id, id));
      if (editing === id) {
        onEditing(null);
        onDeleted();
      }
    });
  };

  const tabs: Array<[Tab, string]> = [
    ["page", editing ? "Editing" : "New page"],
    ["mine", "My pages"],
    ["bits", "Blast & bin"],
    ["notes", waiting ? `Notes (${waiting})` : "Notes"],
  ];

  return (
    <div className="body wr">
      <div className="wr-tabs" role="tablist" aria-label="Notepad">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`wr-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`wr-panel-${id}`}
            className="wr-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {me.suspended && (
        <p className="err wr-banner" role="alert">
          Your account can&apos;t post right now. You can still read, and delete your own pages.
        </p>
      )}

      {tab === "page" && (
        <form
          className="wr-panel wr-form"
          id="wr-panel-page"
          role="tabpanel"
          aria-labelledby="wr-tab-page"
          onSubmit={save}
        >
          {loading && <p className="acc-dim">Opening the page…</p>}
          {restorable && (
            <p className="wr-kept" role="status">
              You have unsaved changes from {hhmm(new Date(restorable.at).toISOString())},{" "}
              {shortDate(new Date(restorable.at).toISOString())}.{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setDraft(restorable.draft);
                  setRestorable(null);
                }}
              >
                Restore them
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  forget(key);
                  setRestorable(null);
                }}
              >
                Throw them away
              </button>
            </p>
          )}
          <label htmlFor="wr-title">Title</label>
          <input
            id="wr-title"
            className="field"
            required
            maxLength={140}
            value={draft.title}
            placeholder="the lamps came on before I got home"
            onChange={(e) => set({ title: e.target.value })}
            aria-invalid={msg?.field === "title" || undefined}
          />

          <label htmlFor="wr-body">The night</label>
          <div className="wr-tools" role="toolbar" aria-label="Markup">
            <button type="button" className="btn" onClick={() => markup.wrap("~~")}>
              <s>cross out</s>
            </button>
            <button type="button" className="btn" onClick={() => markup.wrap("_")}>
              <em>italic</em>
            </button>
            <button type="button" className="btn" onClick={() => markup.wrap("\n\n> ", "\n\n", "a note in the margin")}>
              margin note
            </button>
            {draft.photos.length > 0 && (
              <button type="button" className="btn" onClick={() => markup.wrap("\n\n[photo ", "]\n\n", "1")}>
                photo here
              </button>
            )}
          </div>
          <textarea
            id="wr-body"
            ref={markup.area}
            className="field"
            required
            rows={12}
            maxLength={20000}
            value={draft.body}
            placeholder="what happened tonight…"
            onChange={(e) => set({ body: e.target.value })}
            aria-invalid={msg?.field === "body" || undefined}
          />
          <p className="wr-hint">
            A blank line starts a new paragraph. ~~words~~ crosses out, _words_ is italic, a line starting with &gt; is
            a handwritten note, [photo 2] puts the second photo in the text.
          </p>

          <div className="wr-row">
            <span>
              <label htmlFor="wr-mood">Mood</label>
              <input
                id="wr-mood"
                className="field"
                maxLength={40}
                value={draft.mood}
                placeholder="drifting"
                onChange={(e) => set({ mood: e.target.value })}
              />
            </span>
            <span>
              <label htmlFor="wr-weather">Weather</label>
              <input
                id="wr-weather"
                className="field"
                maxLength={60}
                value={draft.weather}
                placeholder="drizzle, 9°"
                onChange={(e) => set({ weather: e.target.value })}
              />
            </span>
          </div>

          <fieldset className="wr-set">
            <legend>The song</legend>
            <SongPicker value={draft.song} onChange={(song) => set({ song })} />
          </fieldset>

          <fieldset className="wr-set">
            <legend>Photos</legend>
            <PhotoPicker photos={draft.photos} onChange={(photos) => set({ photos })} disabled={me.suspended} />
          </fieldset>

          <div className="wr-row">
            <span>
              <label htmlFor="wr-vis">Who can read it</label>
              <select
                id="wr-vis"
                className="field"
                value={draft.visibility}
                onChange={(e) => set({ visibility: e.target.value as Visibility })}
              >
                <option value="public">Everyone</option>
                <option value="private">Only me</option>
                <option value="draft">Draft</option>
              </select>
            </span>
            <span>
              <label htmlFor="wr-when">Written at</label>
              <input
                id="wr-when"
                type="datetime-local"
                className="field"
                value={draft.writtenAt}
                onChange={(e) => set({ writtenAt: e.target.value })}
              />
            </span>
          </div>
          <details className="wr-more">
            <summary>Page address</summary>
            <label htmlFor="wr-slug">
              /u/{me.handle}/
              <input
                id="wr-slug"
                className="field"
                maxLength={80}
                pattern="[a-z0-9-]*"
                value={draft.slug}
                placeholder="made from the date and title"
                onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
                aria-invalid={msg?.field === "slug" || undefined}
              />
            </label>
          </details>

          <Line msg={msg} />
          <div className="wr-actions">
            <button className="btn" type="submit" disabled={pending || loading || me.suspended}>
              {editing ? "Save changes" : draft.visibility === "public" ? "Post this page" : "Save"}
            </button>
            {editing && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMsg(null);
                    onEditing(null);
                  }}
                >
                  New page
                </button>
                <button type="button" className="btn buzz" onClick={() => remove(editing, draft.title)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </form>
      )}

      {tab === "mine" && (
        <div className="wr-panel" id="wr-panel-mine" role="tabpanel" aria-labelledby="wr-tab-mine">
          {mine === null && <p className="acc-dim">Loading…</p>}
          {mine?.length === 0 && <p className="acc-dim">No pages yet. Your first one starts on the New page tab.</p>}
          <ul className="wr-list">
            {mine?.map((e) => (
              <li key={e.id}>
                <span>
                  <b>{e.title}</b>
                  <small>
                    {shortDate(e.writtenAt)}, {hhmm(e.writtenAt)} · {VIS_LABEL[e.visibility]} · {e.noteCount} notes
                    {e.status === "hidden" && " · hidden by the moderator"}
                  </small>
                </span>
                <span className="wr-acts">
                  {e.visibility === "public" && e.status === "visible" && (
                    <DeskLink className="btn" href={`/u/${me.handle}/${e.slug}`}>
                      Open
                    </DeskLink>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setMsg(null);
                      setTab("page");
                      onEditing(e.id);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn" onClick={() => remove(e.id, e.title)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <Line msg={msg} />
        </div>
      )}

      {tab === "bits" && (
        <div className="wr-panel" id="wr-panel-bits" role="tabpanel" aria-labelledby="wr-tab-bits">
          <form
            className="wr-inline"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await addBlast(blastText);
                if (!res.ok) return setMsg({ kind: "err", text: res.error });
                setBlastText("");
                setBlasts((b) => [res.blast, ...(b ?? [])]);
              });
            }}
          >
            <label htmlFor="wr-blast">Blast: one line on your Messenger, like a status</label>
            <span className="acc-row">
              <input
                id="wr-blast"
                className="field"
                maxLength={140}
                required
                value={blastText}
                placeholder="rain again. no one's coming."
                onChange={(e) => setBlastText(e.target.value)}
              />
              <button className="btn" type="submit" disabled={pending || me.suspended}>
                Blast
              </button>
            </span>
          </form>
          <ul className="wr-list">
            {blasts?.map((b) => (
              <li key={b.id}>
                <span>
                  {b.body}
                  <small>{shortDate(b.createdAt)}</small>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    start(async () => {
                      if ((await deleteBlast(b.id)).ok) setBlasts((x) => x?.filter((y) => y.id !== b.id) ?? null);
                    })
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>

          <form
            className="wr-inline"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await addAlmost(binText);
                if (!res.ok) return setMsg({ kind: "err", text: res.error });
                setBinText("");
                setBin((b) => [res.item, ...(b ?? [])]);
              });
            }}
          >
            <label htmlFor="wr-bin">Almost posted: a line you took back, shown crossed out</label>
            <span className="acc-row">
              <input
                id="wr-bin"
                className="field"
                maxLength={280}
                required
                value={binText}
                placeholder="i miss who i was in 2006."
                onChange={(e) => setBinText(e.target.value)}
              />
              <button className="btn" type="submit" disabled={pending || me.suspended}>
                Bin it
              </button>
            </span>
          </form>
          <ul className="wr-list">
            {bin?.map((a) => (
              <li key={a.id}>
                <span>
                  <s>{a.body}</s>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    start(async () => {
                      if ((await deleteAlmost(a.id)).ok) setBin((x) => x?.filter((y) => y.id !== a.id) ?? null);
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <Line msg={msg} />
        </div>
      )}

      {tab === "notes" && (
        <div className="wr-panel" id="wr-panel-notes" role="tabpanel" aria-labelledby="wr-tab-notes">
          <p className="acc-dim">
            Notes people left on your pages. Ones with a link wait here until you show them; you can hide any note.
          </p>
          {inbox === null && <p className="acc-dim">Loading…</p>}
          {inbox?.length === 0 && <p className="acc-dim">No notes yet.</p>}
          <ul className="wr-list">
            {inbox?.map((n) => (
              <li key={n.id} className={n.status === "pending" ? "wr-wait" : undefined}>
                <span>
                  {n.body}
                  <small>
                    {n.name} on “{n.title}” · {shortDate(n.createdAt)}
                    {n.status === "pending" ? " · waiting for you" : n.status === "hidden" ? " · hidden" : ""}
                  </small>
                </span>
                <span className="wr-acts">
                  {n.status !== "visible" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        start(async () => {
                          if ((await moderateNote(n.id, "visible")).ok)
                            setInbox((x) => x?.map((y) => (y.id === n.id ? { ...y, status: "visible" } : y)) ?? null);
                        })
                      }
                    >
                      Show
                    </button>
                  )}
                  {n.status !== "hidden" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        start(async () => {
                          if ((await moderateNote(n.id, "hidden")).ok)
                            setInbox((x) => x?.map((y) => (y.id === n.id ? { ...y, status: "hidden" } : y)) ?? null);
                        })
                      }
                    >
                      Hide
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
