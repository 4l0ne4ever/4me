"use client";

import type { Shout } from "@4me/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiSend, hhmm } from "@/lib/api";
import { nudgeInk } from "../ink/Ink";
import { useTurnstile } from "../Turnstile";

const EMOTICONS = [":-)", ":-(", "<3", ";-)", "zzz", "^_^"];

export function Guestbook({ initial }: { initial: Shout[] }) {
  const [shouts, setShouts] = useState(initial);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const human = useTurnstile();

  useEffect(() => {
    if (shouts.length) list.current?.scrollTo({ top: 1e6 });
  }, [shouts]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const res = await apiSend<{ shout: Shout; pending: boolean }>("/guestbook", {
      name,
      body: text,
      turnstileToken: human.token,
    });
    setBusy(false);
    human.reset();
    if (!res.ok) return setNote(res.error);
    setText("");
    if (res.data.pending) setNote("thanks. your shout shows up once 4me has seen it.");
    else setShouts((s) => [...s, res.data.shout]);
    nudgeInk("note");
  };

  return (
    <>
      <div className="body shouts" ref={list} aria-live="polite">
        {shouts.length === 0 && <p className="shout">Nobody has signed yet. Be the first.</p>}
        {shouts.map((s) => (
          <div className="shout" key={s.id}>
            <div>
              <b>{s.name}</b>
              <span> · {hhmm(s.createdAt)}</span>
            </div>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      {note && (
        <p className="err" role="status">
          {note}
        </p>
      )}
      {human.widget}
      <form className="gform" onSubmit={send}>
        <fieldset className="emos">
          <legend className="sr">Add an emoticon</legend>
          {EMOTICONS.map((emo) => (
            <button
              key={emo}
              type="button"
              onClick={() => {
                setText((t) => (t ? `${t} ${emo}` : emo));
                input.current?.focus();
              }}
            >
              {emo}
            </button>
          ))}
        </fieldset>
        <div className="grow">
          <label htmlFor="g-name" className="sr">
            Your name
          </label>
          <input
            id="g-name"
            className="field"
            style={{ flex: "0 0 96px" }}
            placeholder="name"
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="g-text" className="sr">
            Your shout
          </label>
          <input
            id="g-text"
            ref={input}
            className="field"
            placeholder="shout something…"
            maxLength={280}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || (human.needed && !human.token)}>
            Shout!
          </button>
        </div>
      </form>
    </>
  );
}
