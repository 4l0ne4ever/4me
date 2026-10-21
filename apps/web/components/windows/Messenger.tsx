"use client";

import type { Author, Blast, ChatMessage, Conversation, Entry, Me, NowPlaying, SearchResults } from "@4me/shared";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { API_URL, apiSend, shortDate, stamp } from "@/lib/api";
import { addToChat, blockMember, buzzChat, chatHistory, leaveChat, sendChat } from "@/lib/chat-actions";
import { useLiveEvent } from "@/lib/live";
import { chatName, useChat } from "../chat/ChatState";
import { DeskLink } from "../DeskLink";
import { useConfirm } from "../Dialog";
import { Eq } from "../Icons";
import { nudgeInk } from "../ink/Ink";

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
  /** The diary's writer, on their desktop: their status at the top. None on the front desktop. */
  persona: Author | null;
  blasts: Blast[];
  awake: boolean;
  live: NowPlaying | null;
  onBuzz: () => void;
  me: Me | null;
};

/**
 * Messenger, like the ones from 2006: on someone's diary, their status at the top (blast, song, online or asleep, a
 * BUZZ for the page); below, the reader's own private conversations, with one person or a group.
 * Notes on a page are written under the page itself.
 */
export function Messenger({ entry, persona, blasts, awake, live, onBuzz, me }: Props) {
  return (
    <div className="body msn">
      {persona && (
        <Buddy entry={entry} persona={persona} blasts={blasts} awake={awake} live={live} onBuzz={onBuzz} me={me} />
      )}
      {me ? (
        <Chats me={me} />
      ) : (
        <p className="msn-guest">
          <a href="/welcome">Log on</a> to send private messages to other writers and start group chats.
        </p>
      )}
    </div>
  );
}

/* ---------- the diary's writer, at the top ---------- */

function Buddy({ entry, persona, blasts, awake, live, onBuzz, me }: Props & { persona: Author }) {
  const { talkTo, chats, active } = useChat();
  const [latest, ...older] = blasts;
  // Already talking with them below: no need to offer it again.
  const open = chats?.find((c) => c.id === active);
  const talking = Boolean(open && !open.group && open.members.some((m) => m.handle === persona.handle));
  const [mounted, setMounted] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);
  const song = live ?? (entry?.song ? { artist: entry.song.artist, title: entry.song.title, live: false } : null);
  const self = me?.handle === persona.handle;

  const buzz = async () => {
    if (!entry) return;
    buzzSound();
    onBuzz();
    nudgeInk("buzz");
    const res = await apiSend<{ buzzCount: number }>(`/entries/${entry.id}/buzz`);
    setSaid(res.ok ? `You shook ${persona.name}'s diary.` : res.error);
  };

  return (
    <section className="buddy" aria-label={`${persona.name}'s status`}>
      <div className="me">
        <img src={persona.avatar} alt="" width={56} height={56} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>
            <DeskLink href={`/u/${persona.handle}`}>{persona.name}</DeskLink>{" "}
            {awake ? <span className="on-dot">(online)</span> : <span className="off-dot">(asleep)</span>}
          </b>
          {latest && (
            <div className="blast">
              <q>{latest.body}</q>
              <small>Blast · {mounted ? ago(latest.createdAt) : shortDate(latest.createdAt)}</small>
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
      <div className="buddy-acts">
        {me && !self && !talking && (
          <button type="button" className="btn" onClick={async () => setSaid(await talkTo([persona.handle]))}>
            Send a message
          </button>
        )}
        {entry && !entry.sealedUntil && (
          <button type="button" className="btn buzz" onClick={buzz} title={`Shake ${persona.name}'s diary`}>
            BUZZ!
          </button>
        )}
      </div>
      {said && (
        <p className="msn-said" role="status">
          {said}
        </p>
      )}
    </section>
  );
}

/* ---------- the reader's conversations ---------- */

function Chats({ me }: { me: Me }) {
  const { chats, active, setActive } = useChat();
  const [composing, setComposing] = useState(false);
  if (active) return <Talk key={active} me={me} id={active} onBack={() => setActive(null)} />;
  if (composing) return <NewChat onDone={() => setComposing(false)} />;
  return (
    <section className="chats" aria-label="Conversations">
      <header className="chats-hd">
        <b>Conversations</b>
        <button type="button" className="btn" onClick={() => setComposing(true)}>
          New message
        </button>
      </header>
      {chats === null && <p className="msn-guest">Loading…</p>}
      {chats?.length === 0 && (
        <p className="msn-guest">No conversations yet. Press New message to write to someone, or to a few people.</p>
      )}
      <ul className="chat-list">
        {chats?.map((c) => (
          <li key={c.id}>
            <button type="button" className={c.unread ? "unread" : undefined} onClick={() => setActive(c.id)}>
              <Faces chat={c} me={me} />
              <span className="cl-main">
                <span className="cl-top">
                  <b>{chatName(c, me)}</b>
                  {c.last && <small>{stamp(c.last.createdAt)}</small>}
                </span>
                <span className="cl-last">
                  {c.last ? preview(c.last, me, c.group) : c.group ? `${c.members.length} people` : "Say hello."}
                </span>
              </span>
              {c.unread > 0 && (
                <span className="cl-n" title={`${c.unread} unread`}>
                  {c.unread > 9 ? "9+" : c.unread}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function preview(m: ChatMessage, me: Me, group: boolean): string {
  if (m.kind === "system") return m.body;
  const who = m.from?.handle === me.handle ? "You" : group ? (m.from?.name ?? "a former reader") : null;
  const text = m.kind === "buzz" ? "BUZZ!!!" : m.body;
  return who ? `${who}: ${text}` : text;
}

/** One face for two people, two overlapping for a group. */
function Faces({ chat, me }: { chat: Conversation; me: Me }) {
  const others = chat.members.filter((m) => m.handle !== me.handle).slice(0, 2);
  return (
    <span className={`faces${others.length > 1 ? " two" : ""}`} aria-hidden="true">
      {others.length === 0 && <span className="face-none" />}
      {others.map((o) => (
        <img key={o.handle} src={o.avatar} alt="" width={36} height={36} />
      ))}
    </span>
  );
}

/* ---------- one conversation ---------- */

function Talk({ me, id, onBack }: { me: Me; id: number; onBack: () => void }) {
  const { chats, upsert, remove, markRead } = useChat();
  const confirm = useConfirm();
  const chat = chats?.find((c) => c.id === id) ?? null;
  const [lines, setLines] = useState<ChatMessage[] | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = useCallback(
    (m: ChatMessage) => setLines((l) => (l ? (l.some((x) => x.id === m.id) ? l : [...l, m]) : [m])),
    [],
  );

  useEffect(() => {
    let alive = true;
    void chatHistory(id).then((h) => {
      if (!alive) return;
      setLines(h);
      setMore(h.length >= 50);
    });
    markRead(id);
    return () => {
      alive = false;
    };
  }, [id, markRead]);

  useLiveEvent((e) => {
    if (e.type === "hello") void chatHistory(id).then(setLines);
    if (e.type === "message" && e.message.conversationId === id) add(e.message);
  });

  const count = useRef(0);
  useEffect(() => {
    const n = lines?.length ?? 0;
    if (n !== count.current) box.current?.scrollTo({ top: 1e6, behavior: count.current ? "smooth" : "auto" });
    count.current = n;
  }, [lines]);

  if (!chat) return null;
  const other = chat.group ? null : (chat.members.find((m) => m.handle !== me.handle) ?? null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendChat(id, text);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setText("");
    add(res.message);
    input.current?.focus();
  };

  const buzz = async () => {
    buzzSound();
    nudgeInk("buzz");
    const res = await buzzChat(id);
    if (res.ok) add(res.message);
    else setError(res.error);
  };

  const older = async () => {
    const first = lines?.[0];
    if (!first) return;
    const h = await chatHistory(id, first.id);
    setMore(h.length >= 50);
    setLines((l) => [...h, ...(l ?? [])]);
  };

  const leave = async () => {
    const ok = await confirm({
      title: "Leave group",
      text: `Leave “${chatName(chat, me)}”? You won't see its messages any more, unless someone adds you again.`,
      ok: "Leave",
      danger: true,
    });
    if (!ok) return;
    const res = await leaveChat(id);
    if (res.ok) remove(id);
    else setError(res.error);
  };

  const block = async (on: boolean) => {
    if (!other) return;
    if (on) {
      const ok = await confirm({
        title: `Block ${other.name}`,
        text: `${other.name} won't be able to message you, start a conversation with you or add you to a group (and you won't be able to message them) until you unblock them. They aren't told.`,
        ok: "Block",
        danger: true,
      });
      if (!ok) return;
    }
    const res = await blockMember(other.handle, on);
    if (res.ok) upsert({ ...chat, blocked: on });
    else setError(res.error);
  };

  return (
    <section className="talk" aria-label={`Conversation: ${chatName(chat, me)}`}>
      <header className="talk-hd">
        <button type="button" className="btn talk-back" onClick={onBack} aria-label="All conversations">
          ‹
        </button>
        <Faces chat={chat} me={me} />
        <span className="talk-who">
          {other ? <DeskLink href={`/u/${other.handle}`}>{other.name}</DeskLink> : <b>{chatName(chat, me)}</b>}
          {chat.group && <small>{chat.members.map((m) => (m.handle === me.handle ? "you" : m.name)).join(", ")}</small>}
        </span>
        {chat.group ? (
          <>
            <button type="button" className="linkish" onClick={() => setAdding((a) => !a)}>
              Add people
            </button>
            <button type="button" className="linkish" onClick={() => void leave()}>
              Leave
            </button>
          </>
        ) : (
          other && (
            <button type="button" className="linkish" onClick={() => void block(!chat.blocked)}>
              {chat.blocked ? "Unblock" : "Block"}
            </button>
          )
        )}
      </header>
      {adding && (
        <People
          label="Add to the group"
          action="Add"
          exclude={chat.members.map((m) => m.handle)}
          onPick={async (handles) => {
            const res = await addToChat(id, handles);
            if (!res.ok) return res.error;
            upsert(res.chat);
            setAdding(false);
            return null;
          }}
        />
      )}
      <div className="chat talk-lines" ref={box} aria-live="polite">
        {more && (
          <button type="button" className="linkish talk-more" onClick={() => void older()}>
            Earlier messages
          </button>
        )}
        {lines === null && <p className="ln sys">Opening…</p>}
        {lines?.length === 0 && <p className="ln sys">Nothing said yet.</p>}
        {lines?.map((m) =>
          m.kind === "system" ? (
            <p className="ln" key={m.id}>
              <span className="sys">{m.body}</span>
            </p>
          ) : (
            <p className="ln" key={m.id}>
              <span className="t">({stamp(m.createdAt)})</span>{" "}
              <span className={`n${m.from?.handle === me.handle ? " own" : ""}`}>
                {m.from?.name ?? "a former reader"}:
              </span>{" "}
              {m.kind === "buzz" ? <span className="buzz">BUZZ!!!</span> : m.body}
            </p>
          ),
        )}
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {chat.blocked ? (
        <p className="compose-hint">
          You blocked {other?.name}.{" "}
          <button type="button" className="linkish" onClick={() => void block(false)}>
            Unblock
          </button>{" "}
          to talk again.
        </p>
      ) : (
        <form className="compose" onSubmit={send}>
          <label htmlFor="talk-text" className="sr">
            Message
          </label>
          <input
            id="talk-text"
            ref={input}
            className="field"
            placeholder="type a message…"
            maxLength={1000}
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>
            Send
          </button>
          <button className="btn buzz" type="button" onClick={() => void buzz()} title="Shake their screen">
            BUZZ!
          </button>
        </form>
      )}
    </section>
  );
}

/* ---------- starting one ---------- */

function NewChat({ onDone }: { onDone: () => void }) {
  const { talkTo } = useChat();
  return (
    <section className="chats" aria-label="New message">
      <header className="chats-hd">
        <b>New message</b>
        <button type="button" className="linkish" onClick={onDone}>
          Cancel
        </button>
      </header>
      <People
        label="To"
        action="Start"
        group
        onPick={async (handles, title) => {
          const error = await talkTo(handles, title);
          if (!error) onDone();
          return error;
        }}
      />
    </section>
  );
}

/** Pick members by name: search as you type, pick one or more, then act. With `group`, two or more get a name. */
function People({
  label,
  action,
  group,
  exclude = [],
  onPick,
}: {
  label: string;
  action: string;
  group?: boolean;
  exclude?: string[];
  onPick: (handles: string[], title?: string) => Promise<string | null>;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<SearchResults["people"]>([]);
  const [picked, setPicked] = useState<SearchResults["people"]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setFound([]);
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (res.ok) setFound(((await res.json()) as SearchResults).people);
      } catch {
        // keep the last suggestions
      }
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const shown = found.filter((p) => !picked.some((x) => x.handle === p.handle) && !exclude.includes(p.handle));

  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(
      await onPick(
        picked.map((p) => p.handle),
        picked.length > 1 ? title.trim() || undefined : undefined,
      ),
    );
    setBusy(false);
  };

  return (
    <form className="people" onSubmit={go}>
      <label htmlFor="people-q">{label}</label>
      <div className="people-box">
        {picked.map((p) => (
          <span key={p.handle} className="chip">
            <img src={p.avatar} alt="" width={18} height={18} />
            {p.name}
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => setPicked((l) => l.filter((x) => x.handle !== p.handle))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="people-q"
          className="field"
          placeholder={picked.length ? "add someone else…" : "a name or desktop address…"}
          value={q}
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {shown.length > 0 && (
        <ul className="people-found">
          {shown.slice(0, 6).map((p) => (
            <li key={p.handle}>
              <button
                type="button"
                onClick={() => {
                  setPicked((l) => (l.length >= 11 ? l : [...l, p]));
                  setQ("");
                  setFound([]);
                }}
              >
                <img src={p.avatar} alt="" width={28} height={28} />
                <span>
                  <b>{p.name}</b>
                  <small>4me://{p.handle}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {group && picked.length > 1 && (
        <>
          <label htmlFor="people-title">Group name (optional)</label>
          <input
            id="people-title"
            className="field"
            maxLength={40}
            placeholder="night shift"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <button className="btn" type="submit" disabled={busy || picked.length === 0}>
        {action}
        {group && picked.length > 1 ? " group" : ""}
      </button>
    </form>
  );
}
