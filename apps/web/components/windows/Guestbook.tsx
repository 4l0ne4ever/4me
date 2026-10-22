"use client";

import { avatarUrl, type Me, type Profile, type Shout } from "@4me/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { API_URL, apiSend, stamp } from "@/lib/api";
import { useFresh, useLiveEvent } from "@/lib/live";
import { banFromDiary, deleteShout, shoutAsMember } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";
import { useConfirm } from "../Dialog";
import { nudgeInk } from "../ink/Ink";
import type { PickedSong } from "../SongPicker";
import { AddSong, SongSticker, toPick } from "../SongSticker";
import { useTurnstile } from "../Turnstile";

const EMOTICONS = [":-)", ":-(", "<3", ";-)", "zzz", "^_^"];

/**
 * A diary's guestbook: words for its writer, not for any one page (those are notes). The front desktop belongs to
 * nobody, so it has no guestbook of its own; it says where to find them.
 */
export function Guestbook({ initial, me, owner }: { initial: Shout[]; me: Me | null; owner: Profile | null }) {
  if (!owner) return <NoGuestbook me={me} />;
  return <Signing initial={initial} me={me} owner={owner} />;
}

function NoGuestbook({ me }: { me: Me | null }) {
  return (
    <div className="body shouts gb-none">
      <p>
        Every diary keeps its own guestbook, for words to its writer rather than to one page. Open someone&apos;s diary,
        from Tonight or Search, to sign theirs.
      </p>
      {me && (
        <p>
          <DeskLink href={`/u/${me.handle}?open=guest`}>Read your own guestbook</DeskLink>
        </p>
      )}
    </div>
  );
}

function Signing({ initial, me, owner }: { initial: Shout[]; me: Me | null; owner: Profile }) {
  const [shouts, setShouts] = useState(initial);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [song, setSong] = useState<PickedSong | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const human = useTurnstile();
  const confirm = useConfirm();
  const isOwner = me?.handle === owner.handle;
  useFresh<Shout[]>(`${API_URL}/guestbook?owner=${encodeURIComponent(owner.handle)}`, setShouts);
  const addShout = (shout: Shout) => setShouts((s) => (s.some((x) => x.id === shout.id) ? s : [...s, shout]));
  useLiveEvent((e) => {
    if (e.type === "shout" && e.owner === owner.handle) addShout(e.shout);
  });

  useEffect(() => {
    if (shouts.length) list.current?.scrollTo({ top: 1e6 });
  }, [shouts]);

  /** The owner takes a shout down, and may keep its writer off the diary too. */
  const takeDown = async (s: Shout, block: boolean) => {
    const ok = await confirm(
      block
        ? {
            title: "Block from your diary",
            text: `Keep ${s.name} off your diary? They won't be able to sign your guestbook or leave notes on your pages. This shout is deleted. You can let them back from My account.`,
            ok: "Block and delete",
            danger: true,
          }
        : { title: "Delete shout", text: "Delete this shout from your guestbook?", ok: "Delete", danger: true },
    );
    if (!ok) return;
    const res = block ? await banFromDiary({ shoutId: s.id }, true) : await deleteShout(s.id);
    if (res.ok) setShouts((l) => l.filter((x) => x.id !== s.id));
    else setNote(res.error);
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const res = me
      ? await shoutAsMember(text, owner.handle, toPick(song)).then((r) =>
          r.ok
            ? { ok: true as const, data: { shout: r.shout, pending: r.pending } }
            : { ok: false as const, error: r.error },
        )
      : await apiSend<{ shout: Shout; pending: boolean }>("/guestbook", {
          name,
          body: text,
          owner: owner.handle,
          song: toPick(song),
          turnstileToken: human.token,
        });
    setBusy(false);
    if (!me) human.reset();
    if (!res.ok) return setNote(res.error);
    setText("");
    setSong(null);
    if (res.data.pending) setNote("thanks. your shout shows up once it has been checked.");
    else addShout(res.data.shout);
    nudgeInk("note");
  };

  return (
    <>
      <div className="body shouts" ref={list} aria-live="polite">
        {shouts.length === 0 && (
          <p className="shout">Nobody has signed {owner.name}&apos;s guestbook yet. Be the first.</p>
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
            {s.song && <SongSticker song={s.song} />}
            {isOwner && s.member?.handle !== me?.handle && (
              <div className="shout-acts">
                <button type="button" className="linkish" onClick={() => void takeDown(s, false)}>
                  delete
                </button>
                <button type="button" className="linkish" onClick={() => void takeDown(s, true)}>
                  block
                </button>
              </div>
            )}
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
        <p className="gb-hint">Words for {owner.name}, not about one page. To answer a page, leave a note under it.</p>
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
        <AddSong value={song} onChange={setSong} />
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
