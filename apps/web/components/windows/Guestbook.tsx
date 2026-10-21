"use client";

import { avatarUrl, type Me, type Profile, type Shout } from "@4me/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { API_URL, apiSend, stamp } from "@/lib/api";
import { useFresh, useLiveEvent } from "@/lib/live";
import { shoutAsMember } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";
import { nudgeInk } from "../ink/Ink";
import { useTurnstile } from "../Turnstile";

const EMOTICONS = [":-)", ":-(", "<3", ";-)", "zzz", "^_^"];

/** The shared guestbook on the front desktop, or a member's own one on theirs. */
export function Guestbook({ initial, me, owner }: { initial: Shout[]; me: Me | null; owner: Profile | null }) {
  const [shouts, setShouts] = useState(initial);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const human = useTurnstile();
  useFresh<Shout[]>(`${API_URL}/guestbook${owner ? `?owner=${encodeURIComponent(owner.handle)}` : ""}`, setShouts);
  const addShout = (shout: Shout) => setShouts((s) => (s.some((x) => x.id === shout.id) ? s : [...s, shout]));
  useLiveEvent((e) => {
    if (e.type === "shout" && e.owner === (owner?.handle ?? null)) addShout(e.shout);
  });

  useEffect(() => {
    if (shouts.length) list.current?.scrollTo({ top: 1e6 });
  }, [shouts]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const res = me
      ? await shoutAsMember(text, owner?.handle).then((r) =>
          r.ok
            ? { ok: true as const, data: { shout: r.shout, pending: r.pending } }
            : { ok: false as const, error: r.error },
        )
      : await apiSend<{ shout: Shout; pending: boolean }>("/guestbook", {
          name,
          body: text,
          owner: owner?.handle,
          turnstileToken: human.token,
        });
    setBusy(false);
    if (!me) human.reset();
    if (!res.ok) return setNote(res.error);
    setText("");
    if (res.data.pending) setNote("thanks. your shout shows up once it has been checked.");
    else addShout(res.data.shout);
    nudgeInk("note");
  };

  return (
    <>
      <div className="body shouts" ref={list} aria-live="polite">
        {shouts.length === 0 && (
          <p className="shout">Nobody has signed {owner ? `${owner.name}'s guestbook` : "yet"}. Be the first.</p>
        )}
        {shouts.map((s) => (
          <div className="shout" key={s.id}>
            <div>
              {s.member && <img className="av" src={s.member.avatar} alt="" width={16} height={16} />}
              <b title={s.member ? "member" : undefined}>
                {s.member ? <DeskLink href={`/u/${s.member.handle}`}>{s.name}</DeskLink> : s.name}
              </b>
              <span> · {stamp(s.createdAt)}</span>
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
      {!me && human.widget}
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
          {me ? (
            <span className="as-me" title={`Signing as ${me.displayName}`}>
              <img src={avatarUrl(me.avatar)} alt="" width={24} height={24} />
              <span className="sr">Signing as {me.displayName}</span>
            </span>
          ) : (
            <>
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
            </>
          )}
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
          <button className="btn" type="submit" disabled={busy || (!me && human.needed && !human.token)}>
            Shout!
          </button>
        </div>
      </form>
    </>
  );
}
