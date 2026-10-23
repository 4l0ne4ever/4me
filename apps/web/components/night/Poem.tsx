"use client";

import { type Me, type NightLine, nightShift } from "@4me/shared";
import { type FormEvent, useEffect, useState } from "react";
import { API_URL, apiSend, longDate } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { addMyLine } from "@/lib/member-actions";
import { useTurnstile } from "../Turnstile";

const dayOfNight = (night: string) => longDate(`${night}T12:00:00+07:00`);

/**
 * Tonight's poem: everyone who comes by adds one line, and the lines stand in the order they came. It closes at six
 * in the morning; last night's reads as a finished piece.
 */
export function Poem({ me, night, title }: { me: Me | null; night: string | null; title?: string }) {
  const [tab, setTab] = useState<"tonight" | "last">("tonight");
  const [lines, setLines] = useState<NightLine[] | null>(null);
  const [last, setLast] = useState<NightLine[] | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const human = useTurnstile();

  useEffect(() => {
    if (!night) return;
    setLines(null);
    void fetch(`${API_URL}/nights/${night}/lines`)
      .then((r) => (r.ok ? (r.json() as Promise<NightLine[]>) : []))
      .then(setLines, () => setLines([]));
    try {
      setMine(Boolean(localStorage.getItem(`4me-line-${night}`)));
    } catch {
      // not known; the server says so if they try twice
    }
  }, [night]);

  useEffect(() => {
    if (!night || tab !== "last" || last) return;
    void fetch(`${API_URL}/nights/${nightShift(night, -1)}/lines`)
      .then((r) => (r.ok ? (r.json() as Promise<NightLine[]>) : []))
      .then(setLast, () => setLast([]));
  }, [night, tab, last]);

  useLiveEvent((e) => {
    if (e.type !== "line" || e.line.night !== night) return;
    setLines((l) => (l && !l.some((x) => x.id === e.line.id) ? [...l, e.line] : l));
  });

  const already = mine || Boolean(me && lines?.some((l) => l.member?.handle === me.handle));

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy || !night) return;
    setBusy(true);
    setMsg(null);
    const res = me
      ? await addMyLine(text).then((r) =>
          r.ok ? { ok: true as const, data: r } : { ok: false as const, error: r.error },
        )
      : await apiSend<{ line: NightLine }>("/nights/lines", { name, body: text, turnstileToken: human.token });
    setBusy(false);
    if (!me) human.reset();
    if (!res.ok) return setMsg(res.error);
    setText("");
    setLines((l) => (l && !l.some((x) => x.id === res.data.line.id) ? [...l, res.data.line] : l));
    setMine(true);
    try {
      localStorage.setItem(`4me-line-${night}`, "1");
    } catch {
      // fine
    }
  };

  const shown = tab === "tonight" ? lines : last;
  const shownNight = night ? (tab === "tonight" ? night : nightShift(night, -1)) : null;
  const people = new Set(shown?.map((l) => l.member?.handle ?? `g:${l.name}`)).size;

  return (
    <div className="body poem">
      <div className="wr-tabs" role="tablist" aria-label="Which night">
        <button
          type="button"
          role="tab"
          className="wr-tab"
          aria-selected={tab === "tonight"}
          onClick={() => setTab("tonight")}
        >
          Tonight
        </button>
        <button
          type="button"
          role="tab"
          className="wr-tab"
          aria-selected={tab === "last"}
          onClick={() => setTab("last")}
        >
          Last night&apos;s
        </button>
      </div>
      <div className="poem-paper">
        {shownNight && <p className="poem-date">{dayOfNight(shownNight)}</p>}
        <h2 className="poem-title">{tab === "tonight" ? (title ?? "Tonight's poem") : "Last night's poem"}</h2>
        <p className="poem-rule">
          {tab === "tonight"
            ? "Everyone adds one line. It closes at six in the morning."
            : `${shown?.length ?? 0} lines from ${people} ${people === 1 ? "person" : "people"}.`}
        </p>
        {shown === null && <p className="poem-empty">…</p>}
        {shown?.length === 0 && (
          <p className="poem-empty">
            {tab === "tonight" ? "No lines yet. The first one sets the tone." : "Nobody wrote a line last night."}
          </p>
        )}
        {shown && shown.length > 0 && (
          <ol className="poem-lines">
            {shown.map((l) => (
              <li key={l.id}>
                <span className="poem-line">{l.body}</span>
                <span className="poem-who">{l.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {tab === "tonight" &&
        (already ? (
          <p className="poem-done">Your line is in tonight. Come back tomorrow night for another.</p>
        ) : (
          <form className="poem-form" onSubmit={send}>
            {!me && (
              <input
                className="field poem-name"
                placeholder="name"
                maxLength={32}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Your name"
              />
            )}
            <input
              className="field"
              placeholder="your one line for tonight…"
              maxLength={120}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Your line"
            />
            {!me && human.widget}
            {msg && (
              <p className="err" role="alert">
                {msg}
              </p>
            )}
            <button
              type="submit"
              className="btn"
              disabled={busy || text.trim().length < 2 || (!me && human.needed && !human.token)}
            >
              Add my line
            </button>
          </form>
        ))}
    </div>
  );
}
