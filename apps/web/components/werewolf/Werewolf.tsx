"use client";

import {
  cannotStart,
  isWolf,
  type LogLine,
  MAX_PLAYERS,
  type Me,
  MIN_PLAYERS,
  type NightStep,
  ROLE_ORDER,
  ROLES,
  type RoleId,
  specialsIn,
  suggestRoles,
  TABLE_LOCKED,
  type TableListing,
  type TableSettings,
  type TableView,
} from "@4me/shared";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { openTable, unlockTable } from "@/lib/table-actions";
import { ROLE_SHORT, RoleIcon } from "./RoleIcon";
import { setWolfSoundOn, sounds, unlockSound, wolfSoundOn } from "./sounds";
import { useTable } from "./useTable";
import { type HouseMark, Village } from "./Village";
import { keyName, Voice, type VoiceState } from "./voice";

// The Werewolf window. Without a table: the open tables, and opening one. At a table: the village (the sky is the
// clock, the houses are the players), the one thing to do now, and a dock with the chat, your card, the log and
// the rules.

export function Werewolf({
  me,
  code,
  onCode,
}: {
  me: Me | null;
  code: string | null;
  onCode: (c: string | null) => void;
}) {
  if (code && me) return <AtTable me={me} code={code} onLeave={() => onCode(null)} />;
  return <Tables me={me} onCode={onCode} />;
}

/* ---------- the open tables ---------- */

function Tables({ me, onCode }: { me: Me | null; onCode: (c: string) => void }) {
  const [list, setList] = useState<TableListing[] | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`${API_URL}/tables`)
        .then((r) => (r.ok ? (r.json() as Promise<TableListing[]>) : []))
        .then((l) => live && setList(l))
        .catch(() => live && setList([]));
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  const open = async () => {
    setBusy(true);
    setError(null);
    const r = await openTable();
    setBusy(false);
    if ("code" in r) onCode(r.code);
    else setError(r.error);
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = typed
      .trim()
      .toLowerCase()
      .replace(/.*table=/, "");
    if (/^[a-z0-9]{6}$/.test(c)) onCode(c);
    else setError("a table's code is six letters and numbers");
  };

  return (
    <div className="body ww ww-list">
      <Village
        view={null}
        me={0}
        marks={new Map()}
        progress={null}
        compact={false}
        onPick={() => {}}
        onHouse={() => {}}
        placeholder={9}
      />
      <div className="ww-intro">
        <h2>A village, a few wolves, one night at a time.</h2>
        <p>The computer tells the story and keeps the time. You talk, suspect, and vote. Five to sixteen players.</p>
        {me ? (
          <div className="ww-start">
            <button type="button" className="btn ww-primary" onClick={open} disabled={busy}>
              {busy ? "Setting the table…" : "Open a table"}
            </button>
            <form className="ww-code" onSubmit={join}>
              <label htmlFor="ww-code">or sit at a friend's</label>
              <input
                id="ww-code"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="code, e.g. k7m2qp"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn">
                Sit down
              </button>
            </form>
          </div>
        ) : (
          <p className="ww-guest">
            <a href="/welcome?next=/">Log on or create an account</a> to sit at a table.
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </div>
      <section className="ww-tables" aria-label="Open tables">
        <h3>Tables tonight</h3>
        {list === null ? (
          <p className="ww-quiet">Looking around the village…</p>
        ) : list.length === 0 ? (
          <p className="ww-quiet">No tables are open. Open one, and send the link to a few friends.</p>
        ) : (
          <ul>
            {list.map((t) => {
              const waiting = t.phase === "lobby";
              const full = t.players >= t.seats;
              return (
                <li key={t.code} className={waiting ? "" : "playing"}>
                  <span className="ww-t-name">
                    {t.locked && (
                      <>
                        <LockIcon />
                        <span className="sr">Needs a password. </span>
                      </>
                    )}
                    {t.host ? `${t.host}'s table` : "A table"}
                  </span>
                  <span className="ww-t-seats" title={`${t.players} of ${t.seats} seats taken`}>
                    <span className="sr">
                      {t.players} of {t.seats} seats taken
                    </span>
                    {Array.from({ length: t.seats }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: seats
                      <i key={i} className={i < t.players ? "on" : ""} />
                    ))}
                  </span>
                  <span className="ww-t-state">{waiting ? (full ? "full" : "waiting") : "playing"}</span>
                  {me && waiting && !full ? (
                    <button type="button" className="btn" onClick={() => onCode(t.code)}>
                      Sit down
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- at a table ---------- */

type Tab = "chat" | "you" | "log" | "rules" | "table";

const PHASE_TITLE: Record<TableView["phase"], string> = {
  lobby: "Table",
  deal: "The deal",
  night: "Night",
  witch: "Night",
  dawn: "Day",
  hunter: "The hunter",
  badge: "The badge",
  election: "Sheriff",
  discussion: "Talk",
  vote: "Vote",
  verdict: "Day",
  over: "The end",
};

/** Who is awake on each turn of the night: the header's title, and the card over the sky when they wake. */
const STEP: Record<NightStep, { title: string; role: RoleId; doing: string }> = {
  cupid: { title: "Cupid", role: "cupid", doing: "draws the bow" },
  seer: { title: "The Seer", role: "seer", doing: "looks into someone's house" },
  guard: { title: "The Bodyguard", role: "bodyguard", doing: "keeps watch" },
  wolves: { title: "The wolves", role: "werewolf", doing: "choose who to eat" },
};

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function AtTable({ me, code, onLeave }: { me: Me; code: string; onLeave: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const { view, status, closed, notice, send, voice, voiceCtl, skew } = useTable(code, me.id, attempt);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("chat");
  const [picked, setPicked] = useState<number[]>([]);
  const [poisoning, setPoisoning] = useState(false);
  const [poison, setPoison] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [unread, setUnread] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const seated = view !== null;
  const phaseStart = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the table's box only exists once the first view has come
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCompact((e?.contentRect.width ?? 800) < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, [seated]);

  const phaseKey = view ? `${view.phase}:${view.day}:${view.actor}:${view.step}` : "";
  // A new phase: forget half-made choices.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the phase changes
  useEffect(() => {
    setPicked([]);
    setPoisoning(false);
    setPoison(null);
    if (view?.phase === "lobby") setTab("table");
    if (view?.phase === "deal") setTab("chat");
  }, [phaseKey]);
  if (view && phaseStart.current.key !== phaseKey) phaseStart.current = { key: phaseKey, at: view.now };
  // On a phone the window scrolls: a new part of the game brings the village back into view, unless they're typing.
  const phase = view?.phase;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the part of the game changes
  useEffect(() => {
    const el = main.current;
    const typing = document.activeElement?.matches("input:not([type=checkbox]), textarea");
    if (el && !typing) el.scrollTop = 0;
  }, [phase]);

  // The story: a title card over the sky when the game turns (night, morning, the vote, the verdict, the end), and
  // the village's sounds with it.
  const [scene, setScene] = useState<Scene | null>(null);
  const story = useRef<{ phase: string; step: string; at: number; alive: Map<number, boolean> } | null>(null);
  useEffect(() => {
    if (!view) return;
    const before = story.current;
    story.current = {
      phase: view.phase,
      step: view.step ?? "",
      at: view.log.at(-1)?.at ?? 0,
      alive: new Map(view.players.map((p) => [p.id, p.alive])),
    };
    if (!before) return; // sitting down in the middle of something: no card for what already happened
    const died = view.players.filter((p) => !p.alive && before.alive.get(p.id) === true);
    const turned = before.phase !== view.phase;
    if (died.length) window.setTimeout(() => sounds.death(), turned && view.phase === "dawn" ? 1300 : 0);
    // the night's turns: a card for each role as it wakes
    if (!turned && view.step && before.step !== view.step) {
      setScene({ ...stepScene(view, view.step), id: Date.now() });
      return;
    }
    if (!turned) return;
    const fresh = view.log.filter((l) => l.at > before.at);
    const next = sceneFor(view, me.id, fresh);
    if (next) setScene({ ...next, id: Date.now() });
    if (view.phase === "night") sounds.night();
    else if (view.phase === "dawn") sounds.dawn();
    else if (view.phase === "vote" || view.phase === "election") sounds.vote();
    else if (view.phase === "verdict") sounds.verdict();
    else if (view.phase === "over") sounds.end(Boolean(view.winner?.ids.includes(me.id)));
  }, [view, me.id]);
  useEffect(() => {
    if (!scene) return;
    const t = window.setTimeout(() => setScene(null), scene.long ? 5600 : 3600);
    return () => window.clearTimeout(t);
  }, [scene]);
  // Browsers play sound only after a click somewhere: the first one in the window unlocks it.
  useEffect(() => {
    const on = () => unlockSound();
    window.addEventListener("pointerdown", on, { once: true });
    return () => window.removeEventListener("pointerdown", on);
  }, []);

  const chatCount = view?.chat.length ?? 0;
  const lastSeen = useRef(0);
  useEffect(() => {
    if (tab === "chat") {
      lastSeen.current = chatCount;
      setUnread(0);
    } else setUnread(Math.max(0, chatCount - lastSeen.current));
  }, [chatCount, tab]);

  const serverNow = now + skew;
  const left = view?.deadline ? view.deadline - serverNow : null;
  const progress =
    view?.deadline && view.deadline > phaseStart.current.at
      ? Math.min(1, Math.max(0, (serverNow - phaseStart.current.at) / (view.deadline - phaseStart.current.at)))
      : null;

  const ask = view?.ask ?? null;
  const witch = view?.witch ?? null;
  // Your turn: a soft ping when there is something for you to choose, and ticks in its last five seconds.
  const waiting = Boolean((ask && !ask.locked && !ask.chosen.length) || (witch && !witch.done));
  const turnKey = waiting ? `${phaseKey}:${ask?.kind ?? "witch"}` : "";
  useEffect(() => {
    if (turnKey) sounds.turn();
  }, [turnKey]);
  const secs = left !== null ? Math.ceil(left / 1000) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once a second, while waiting on you
  useEffect(() => {
    if (waiting && secs !== null && secs > 0 && secs <= 5) sounds.tick();
  }, [secs]);
  const pickingPoison = Boolean(witch && poisoning && !witch.done);
  const marks = useMemo(() => {
    const m = new Map<number, HouseMark>();
    if (!view) return m;
    const tallies = new Map<number, number>();
    for (const [voter, target] of Object.entries(view.votes ?? {})) {
      if (!target) continue;
      const weight = view.phase === "vote" && view.players.find((p) => p.id === Number(voter))?.sheriff ? 2 : 1;
      tallies.set(target, (tallies.get(target) ?? 0) + weight);
    }
    const pack = new Map<number, number>();
    for (const ids of Object.values(view.pack ?? {})) for (const id of ids) pack.set(id, (pack.get(id) ?? 0) + 1);
    const choices = new Set(
      pickingPoison ? view.players.filter((p) => p.alive && p.id !== me.id).map((p) => p.id) : (ask?.choices ?? []),
    );
    const chosen = new Set(pickingPoison ? (poison ? [poison] : []) : picked.length ? picked : (ask?.chosen ?? []));
    for (const p of view.players)
      m.set(p.id, {
        pickable: choices.has(p.id) && !ask?.locked,
        chosen: chosen.has(p.id),
        tally: tallies.get(p.id) ?? 0,
        wolfPick: pack.get(p.id) ?? 0,
        speaking: voice?.speaking.has(p.id) ?? false,
      });
    return m;
  }, [view, ask, picked, voice, pickingPoison, poison, me.id]);

  if (closed === TABLE_LOCKED) return <Locked code={code} onOpen={() => setAttempt((a) => a + 1)} onLeave={onLeave} />;
  if (closed)
    return (
      <div className="body ww ww-gone">
        <p>{closed[0]?.toUpperCase() + closed.slice(1)}.</p>
        <button type="button" className="btn" onClick={onLeave}>
          Back to the tables
        </button>
      </div>
    );
  if (!view)
    return (
      <div className="body ww ww-gone">
        <p>{status === "reconnecting" ? "The line dropped. Knocking again…" : "Knocking on the door…"}</p>
        <button type="button" className="linkish" onClick={onLeave}>
          Back to the tables
        </button>
      </div>
    );

  const name = (id: number) => (id === me.id ? "you" : (view.players.find((p) => p.id === id)?.name ?? "someone"));
  const isHost = view.host === me.id;
  const narrator =
    view.log.at(-1)?.text ??
    (isHost ? "Invite people, set the roles, then start." : "Waiting for everyone to sit down.");

  const pick = (id: number) => {
    if (pickingPoison) {
      setPoison((p) => (p === id ? null : id));
      return;
    }
    if (!ask) return;
    if (ask.pick === 1) {
      setPicked([id]);
      // Choices that can be changed go straight in; the Seer confirms.
      if (ask.kind !== "seer" && ask.kind !== "hunter" && ask.kind !== "badge") send({ t: "pick", ids: [id] });
      return;
    }
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-ask.pick);
    setPicked(next);
    if (next.length === ask.pick) send({ t: "pick", ids: next });
  };

  return (
    <div className={`body ww ww-game ww-${view.phase}`} ref={root}>
      <header className="ww-top">
        <div className="ww-when">
          <span className="ww-phase">
            {PHASE_TITLE[view.phase]}
            {view.day > 0 && view.phase !== "over" && view.phase !== "lobby" ? ` ${view.day}` : ""}
            {view.phase === "lobby" ? ` ${view.code}` : ""}
          </span>
          {(view.step || view.phase === "witch") && (
            <span className="ww-turn">
              <RoleIcon of={view.step ? STEP[view.step].role : "witch"} />
              {view.step ? STEP[view.step].title : "The Witch"}
            </span>
          )}
          {left !== null && (
            <span className={`ww-clock${left < 10_000 ? " late" : ""}`}>
              <span className="sr">time left </span>
              {clock(left)}
            </span>
          )}
          <SoundToggle />
        </div>
        <p className="ww-say" aria-live="polite">
          {narrator}
        </p>
        <VoiceBar voice={voice} ctl={voiceCtl.current} canTalk={view.voice.speakTo.length > 0} view={view} me={me.id} />
      </header>

      <div className="ww-main" ref={main}>
        <div className="ww-stage">
          <Village
            view={view}
            me={me.id}
            marks={marks}
            progress={progress}
            compact={compact}
            onPick={pick}
            onHouse={(id) => setFocus((f) => (f === id ? null : id))}
          />
          {scene && (
            <div key={scene.id} className={`ww-scene ${scene.tone}${scene.long ? " long" : ""}`} aria-hidden="true">
              <b>{scene.title}</b>
              {scene.line && <span>{scene.line}</span>}
            </div>
          )}
          <Action
            view={view}
            me={me}
            picked={picked}
            name={name}
            send={send}
            onLeave={onLeave}
            poisoning={poisoning}
            setPoisoning={setPoisoning}
            poison={poison}
            setPoison={setPoison}
            setPicked={setPicked}
          />
          {focus !== null && (
            <Neighbour
              view={view}
              id={focus}
              me={me.id}
              voice={voice}
              ctl={voiceCtl.current}
              onClose={() => setFocus(null)}
              send={send}
            />
          )}
          {notice && (
            <p className="ww-notice" role="status">
              {notice}
            </p>
          )}
        </div>

        <aside className="ww-dock">
          <div className="ww-tabs" role="tablist">
            {(view.phase === "lobby"
              ? (["table", "chat", "rules"] as Tab[])
              : (["chat", "you", "log", "rules"] as Tab[])
            ).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "on" : ""}
                onClick={() => setTab(t)}
              >
                {t === "table"
                  ? "Table"
                  : t === "you"
                    ? "Your card"
                    : t === "chat"
                      ? "Chat"
                      : t === "log"
                        ? "What happened"
                        : "Rules"}
                {t === "chat" && unread > 0 && <span className="ww-unread">{unread}</span>}
              </button>
            ))}
          </div>
          <div className="ww-pane">
            {tab === "chat" && <Chat view={view} me={me.id} send={send} />}
            {tab === "you" && <Card view={view} name={name} />}
            {tab === "log" && <Log view={view} />}
            {tab === "rules" && <Rules />}
            {tab === "table" && <Settings view={view} host={isHost} send={send} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- the one thing to do now ---------- */

function Action({
  view,
  me,
  picked,
  name,
  send,
  onLeave,
  poisoning,
  setPoisoning,
  poison,
  setPoison,
  setPicked,
}: {
  view: TableView;
  me: Me;
  picked: number[];
  name: (id: number) => string;
  send: ReturnType<typeof useTable>["send"];
  onLeave: () => void;
  poisoning: boolean;
  setPoisoning: (b: boolean) => void;
  poison: number | null;
  setPoison: (n: number | null) => void;
  setPicked: (ids: number[]) => void;
}) {
  const ask = view.ask;
  const you = view.me;
  const [copied, setCopied] = useState(false);
  const chosen = picked.length ? picked : (ask?.chosen ?? []);

  if (view.phase === "lobby") {
    const why = cannotStart(view.settings, view.players.filter((p) => p.connected).length);
    const invite = typeof window === "undefined" ? "" : `${window.location.origin}/?table=${view.code}`;
    return (
      <div className="ww-act">
        <p className="ww-ask">
          {view.players.length} of {view.settings.seats} seats taken.{" "}
          {view.host === me.id ? "Start when everyone is here." : `${name(view.host)} starts the game.`}
          {view.locked && " Newcomers need the password."}
        </p>
        <div className="ww-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(invite).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            {copied ? "Link copied" : "Copy the invite link"}
          </button>
          {view.host === me.id && (
            <button
              type="button"
              className="btn ww-primary"
              disabled={Boolean(why)}
              onClick={() => send({ t: "start" })}
            >
              Deal the cards
            </button>
          )}
          <button type="button" className="linkish" onClick={() => send({ t: "leave" })}>
            Leave
          </button>
        </div>
        {view.host === me.id && why && (
          <p className="ww-hint">
            Can't start yet: {why}.{" "}
            {view.players.length < MIN_PLAYERS && (
              <button
                type="button"
                className="linkish ww-fill"
                onClick={() => {
                  for (let i = view.players.length; i < MIN_PLAYERS; i++) send({ t: "bot", add: true });
                }}
              >
                Fill the empty seats with computer players
              </button>
            )}
          </p>
        )}
      </div>
    );
  }

  if (view.phase === "over") {
    const w = view.winner;
    const won = w?.ids.includes(me.id);
    return (
      <div className="ww-act ww-end">
        <p className="ww-big">{w?.team === "nobody" ? "Nobody wins." : won ? "You won." : "You lost."}</p>
        <ul className="ww-cast" aria-label="Who was who">
          {view.players.map((p) =>
            p.role ? (
              <li key={p.id} className={ROLES[p.role].team}>
                <RoleIcon of={p.role} />
                <b>{p.id === me.id ? "you" : p.name}</b>
                <span>{p.turned ? "Cursed → wolf" : ROLE_SHORT[p.role]}</span>
              </li>
            ) : null,
          )}
        </ul>
        <div className="ww-row">
          {view.host === me.id && (
            <button type="button" className="btn ww-primary" onClick={() => send({ t: "again" })}>
              Same table, new cards
            </button>
          )}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              send({ t: "leave" });
              onLeave();
            }}
          >
            Leave the table
          </button>
        </div>
      </div>
    );
  }

  if (view.phase === "deal" && you?.role) {
    return (
      <div className="ww-act ww-deal">
        <div className={`ww-card ${ROLES[you.role].team}`}>
          <RoleIcon of={you.role} className="big" />
          <div>
            <p className="ww-card-name">You are the {ROLES[you.role].name}.</p>
            <p>{ROLES[you.role].blurb}</p>
          </div>
        </div>
      </div>
    );
  }

  if (view.witch && !view.witch.done) {
    const w = view.witch;
    const heal = w.heal && w.attacked.length > 0;
    return (
      <div className="ww-act">
        <p className="ww-ask">
          {w.attacked.length ? (
            <>The wolves attacked {w.attacked.map(name).join(" and ")}.</>
          ) : (
            "The wolves attacked nobody."
          )}{" "}
          {poisoning ? "Tap a house to poison." : ""}
        </p>
        <div className="ww-row">
          {heal &&
            w.attacked.map((id) => (
              <button key={id} type="button" className="btn" onClick={() => send({ t: "witch", heal: id, poison })}>
                Save {name(id)}
              </button>
            ))}
          {w.poison &&
            (poisoning ? (
              <button
                type="button"
                className="btn danger"
                disabled={poison === null}
                onClick={() => send({ t: "witch", heal: null, poison })}
              >
                {poison ? `Poison ${name(poison)}` : "Pick someone"}
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setPoisoning(true)}>
                Use the poison…
              </button>
            ))}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setPoison(null);
              setPoisoning(false);
              send({ t: "witch", heal: null, poison: null });
            }}
          >
            Do nothing tonight
          </button>
        </div>
        <p className="ww-hint">
          Potions left: {[w.heal && "save", w.poison && "poison"].filter(Boolean).join(" and ") || "none"}.
        </p>
      </div>
    );
  }

  if (ask) {
    const prompt: Record<typeof ask.kind, string> = {
      wolf:
        ask.pick === 2
          ? "Tap two houses: the pack is hungry tonight."
          : "Tap a house: tonight's meal. The pack must agree.",
      seer: "Tap a house to look inside.",
      guard: "Tap a house to guard tonight.",
      cupid: "Tap two houses: they fall in love.",
      vote: "Tap a house to vote them out.",
      election: "Tap a house to make them sheriff.",
      hunter: "You're going down. Tap a house to take with you.",
      badge: "Pass the sheriff's badge: tap a house.",
    };
    const confirm = ask.kind === "seer" || ask.kind === "hunter" || ask.kind === "badge";
    return (
      <div className="ww-act">
        <p className="ww-ask">
          {ask.locked
            ? ask.kind === "seer"
              ? `You looked. ${view.notes.at(-1)?.text.replace(/^Night \d+: /, "") ?? ""}`
              : "Done for tonight."
            : prompt[ask.kind]}
          {!confirm && chosen.length > 0 && chosen[0] !== 0 && !ask.locked && (
            <span className="ww-chosen"> Chosen: {chosen.map(name).join(" and ")}.</span>
          )}
        </p>
        <div className="ww-row">
          {confirm && !ask.locked && (
            <button
              type="button"
              className="btn ww-primary"
              disabled={picked.length !== 1}
              onClick={() => send({ t: "pick", ids: picked })}
            >
              {picked.length
                ? `${ask.kind === "seer" ? "Look at" : ask.kind === "hunter" ? "Shoot" : "Give it to"} ${name(picked[0]!)}`
                : "Pick a house"}
            </button>
          )}
          {ask.choices.includes(0) && (
            <button
              type="button"
              className={`btn${chosen[0] === 0 ? " on" : ""}`}
              onClick={() => {
                setPicked([0]);
                send({ t: "pick", ids: [0] });
              }}
            >
              {ask.kind === "hunter" ? "Lower the gun" : ask.kind === "badge" ? "Tear it up" : "Nobody"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view.phase === "discussion" && you?.alive) {
    const living = view.players.filter((p) => p.alive);
    const ready = living.filter((p) => p.ready).length;
    return (
      <div className="ww-act">
        <div className="ww-row">
          <label className="ww-check">
            <input
              type="checkbox"
              checked={you.ready}
              onChange={(e) => send({ t: "ready", ready: e.target.checked })}
            />
            Ready to vote
          </label>
          <span className="ww-hint">
            {ready} of {living.length} ready; the vote starts at {Math.ceil((living.length * 2) / 3)}.
          </span>
        </div>
      </div>
    );
  }

  const quiet = !you
    ? "You're watching."
    : !you.alive
      ? "You're dead. Watch, and talk with the other ghosts."
      : view.phase === "night" && view.step
        ? `You sleep. ${STEP[view.step].title} ${view.step === "wolves" ? "are" : "is"} awake.`
        : view.phase === "witch"
          ? "You sleep. The Witch is awake."
          : view.phase === "night" || view.phase === "deal"
            ? "You sleep. The night belongs to the others."
            : view.phase === "vote" && !you.canVote
              ? "You lost your vote when they found out who you are."
              : "Listen.";
  return (
    <div className="ww-act">
      <p className="ww-ask quiet">{quiet}</p>
    </div>
  );
}

/** A tap on a house when there's nothing to choose: who lives there, and their voice. */
function Neighbour({
  view,
  id,
  me,
  voice,
  ctl,
  onClose,
  send,
}: {
  view: TableView;
  id: number;
  me: number;
  voice: VoiceState | null;
  ctl: Voice | null;
  onClose: () => void;
  send: ReturnType<typeof useTable>["send"];
}) {
  const p = view.players.find((x) => x.id === id);
  if (!p) return null;
  return (
    <div className="ww-who" role="dialog" aria-label={p.name}>
      <img src={p.avatar} alt="" width={36} height={36} />
      <div>
        <b>{p.id === me ? "You" : p.name}</b>
        <span>
          {p.bot ? "a computer player · " : ""}
          {p.alive ? (p.connected ? "at the table" : "stepped away") : "dead"}
          {p.role ? ` · ${ROLE_SHORT[p.role]}` : ""}
          {p.sheriff ? " · sheriff" : ""}
        </span>
      </div>
      {p.id !== me && voice?.on && ctl && !p.bot && (
        <div className="ww-who-voice">
          <PersonVoice id={p.id} name={p.name} voice={voice} ctl={ctl} />
        </div>
      )}
      <div className="ww-who-acts">
        {!p.bot && (
          <a className="btn" href={`/u/${p.handle}`} target="_blank" rel="noreferrer">
            Their diary
          </a>
        )}
        {(view.phase === "lobby" || view.phase === "over") && view.host === me && p.id !== me && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                send({ t: "kick", id });
                onClose();
              }}
            >
              {p.bot ? "Send them home" : "Ask them to leave"}
            </button>
            {!p.bot && (
              <button
                type="button"
                className="btn danger"
                title="They can't sit at this table again"
                onClick={() => {
                  send({ t: "kick", id, ban: true });
                  onClose();
                }}
              >
                Ban from this table
              </button>
            )}
          </>
        )}
        <button type="button" className="linkish" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------- the story ---------- */

type Scene = {
  id: number;
  tone: "night" | "dawn" | "day" | "dusk" | "win" | "lose";
  title: string;
  line: string;
  long?: boolean;
};

const WINNERS: Record<string, string> = {
  wolves: "The wolves win",
  village: "The village wins",
  lovers: "The lovers win",
  tanner: "The tanner wins",
  nobody: "Nobody wins",
};

/** A role wakes in the night: whose turn it is, and whether it's yours. */
function stepScene(view: TableView, step: NightStep): Omit<Scene, "id"> {
  const you = view.me;
  const yours = Boolean(view.ask && !view.ask.locked);
  return {
    tone: "night",
    title: STEP[step].title,
    line: yours
      ? "Your turn. Tap a house."
      : you?.alive && you.role && (step === "wolves" ? isWolf(you.role) : STEP[step].role === you.role)
        ? "Your turn."
        : `${step === "wolves" ? "wake and" : "wakes and"} ${STEP[step].doing}.`,
  };
}

/** The title card for the part of the game that has just begun, from what the narrator has just said. */
function sceneFor(view: TableView, me: number, fresh: LogLine[]): Omit<Scene, "id"> | null {
  const said = (kinds: LogLine["kind"][]) =>
    fresh
      .filter((l) => kinds.includes(l.kind))
      .map((l) => l.text)
      .slice(-2)
      .join(" ");
  const you = view.me;
  switch (view.phase) {
    case "night":
      return {
        tone: "night",
        title: `Night ${view.day}`,
        line: view.step
          ? `${STEP[view.step].title} ${view.step === "wolves" ? "wake" : "wakes"} first.`
          : you?.alive
            ? "The village sleeps."
            : "The dead watch the dark.",
      };
    case "witch":
      return { tone: "night", title: "The Witch", line: "wakes, and sees who the wolves attacked." };
    case "dawn":
      return { tone: "dawn", title: `Day ${view.day}`, line: said(["death"]) || "Everyone woke up." };
    case "election":
      return { tone: "day", title: "The sheriff", line: "The village chooses who speaks for it." };
    case "vote":
      return { tone: "day", title: "The vote", line: "Who leaves the village?" };
    case "verdict":
      return { tone: "dusk", title: "The verdict", line: said(["death", "day", "info"]) };
    case "hunter":
      return { tone: "dusk", title: "The hunter", line: "One last shot." };
    case "over": {
      const w = view.winner;
      const won = Boolean(w?.ids.includes(me));
      return {
        tone: won ? "win" : "lose",
        title: WINNERS[w?.team ?? "nobody"] ?? "The end",
        line: won ? "You won." : w?.team === "nobody" ? "" : "You lost.",
        long: true,
      };
    }
    default:
      return null;
  }
}

function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(wolfSoundOn()), []);
  return (
    <button
      type="button"
      className={`ww-sound${on ? "" : " off"}`}
      aria-pressed={on}
      aria-label={on ? "Sounds on" : "Sounds off"}
      title={on ? "Sounds on: click to turn them off" : "Sounds off: click to turn them on"}
      onClick={() => {
        setWolfSoundOn(!on);
        setOn(!on);
        if (!on) {
          unlockSound();
          sounds.turn();
        }
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 6h2.6L8.6 3v10L5.1 10H2.5z" />
        {on ? (
          <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8 M12.4 3.8a6 6 0 0 1 0 8.4" />
        ) : (
          <path d="M10.6 6l3.6 4 M14.2 6l-3.6 4" />
        )}
      </svg>
    </button>
  );
}

/* ---------- voice ---------- */

/**
 * The voice, as a game has it: everyone at the table is heard from the start; you talk by holding a key (or the button)
 * or with an open microphone; and a settings panel for the key, the microphone, everyone's volume and each player's.
 */
function VoiceBar({
  voice,
  ctl,
  canTalk,
  view,
  me,
}: {
  voice: ReturnType<typeof useTable>["voice"];
  ctl: Voice | null;
  canTalk: boolean;
  view: TableView;
  me: number;
}) {
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Browsers play sound only after a click: every click wakes the voice's sound, should it be asleep.
  useEffect(() => {
    if (!ctl) return;
    const wake = () => ctl.wake();
    window.addEventListener("pointerdown", wake);
    return () => window.removeEventListener("pointerdown", wake);
  }, [ctl]);
  // Hold the talk key to talk, unless typing (or choosing a new key).
  useEffect(() => {
    if (!voice?.on || voice.mode !== "ptt" || !ctl || capturing) return;
    const typing = (e: globalThis.KeyboardEvent) => (e.target as Element | null)?.closest("input, textarea, select");
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.code !== voice.key || e.repeat || typing(e)) return;
      e.preventDefault();
      ctl.talk(true);
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.code === voice.key) ctl.talk(false);
    };
    const away = () => ctl.talk(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", away);
    };
  }, [voice?.on, voice?.mode, voice?.key, ctl, capturing]);

  if (!voice || !ctl) return null;
  const hold = (on: boolean) => () => ctl.talk(on);
  return (
    <div className="ww-voice">
      {voice.on ? (
        <>
          <span className="ww-linked" title="You, and the players whose voice reaches this browser">
            <i className={voice.linked.size ? "on" : ""} aria-hidden="true" />
            {voice.linked.size + 1} in the voice
          </span>
          {voice.micBlocked ? (
            <span className="ww-hint">listening only</span>
          ) : voice.mode === "ptt" ? (
            <button
              type="button"
              className={`btn ww-ptt${voice.talking ? " on" : ""}`}
              onPointerDown={hold(true)}
              onPointerUp={hold(false)}
              onPointerCancel={hold(false)}
              onPointerLeave={hold(false)}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e: KeyboardEvent) => e.key === " " && !e.repeat && ctl.talk(true)}
              onKeyUp={(e: KeyboardEvent) => e.key === " " && ctl.talk(false)}
              disabled={!canTalk}
              title={canTalk ? `Hold this, or ${keyName(voice.key)}, to talk` : "Nobody can hear you right now"}
            >
              <MicIcon off={!canTalk} />
              {!canTalk ? "Quiet now" : voice.talking ? "Talking…" : `Hold ${keyName(voice.key)} to talk`}
            </button>
          ) : (
            <button
              type="button"
              className={`btn ww-mic${voice.muted || !canTalk ? " off" : ""}`}
              onClick={() => ctl.setMuted(!voice.muted)}
              aria-pressed={!voice.muted}
              title={canTalk ? "Your microphone is open: click to switch it off" : "Nobody can hear you right now"}
            >
              <MicIcon off={voice.muted || !canTalk} />
              {voice.muted ? "Mic off" : canTalk ? "Mic on" : "Quiet now"}
            </button>
          )}
        </>
      ) : (
        <button type="button" className="btn ww-join" onClick={() => void ctl.join()}>
          <SpeakerIcon off /> Voice off
        </button>
      )}
      <button
        type="button"
        className={`btn ww-gear${open ? " on" : ""}`}
        aria-expanded={open}
        aria-label="Voice settings"
        title="Voice settings"
        onClick={() => setOpen(!open)}
      >
        <GearIcon />
      </button>
      {open && (
        <VoicePanel
          voice={voice}
          ctl={ctl}
          view={view}
          me={me}
          capturing={capturing}
          setCapturing={setCapturing}
          onClose={() => {
            setOpen(false);
            setCapturing(false);
          }}
        />
      )}
    </div>
  );
}

function VoicePanel({
  voice,
  ctl,
  view,
  me,
  capturing,
  setCapturing,
  onClose,
}: {
  voice: VoiceState;
  ctl: Voice;
  view: TableView;
  me: number;
  capturing: boolean;
  setCapturing: (b: boolean) => void;
  onClose: () => void;
}) {
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([]);
  // (names show once a microphone has been allowed: look again then)
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasMic changes what the browser will tell
  useEffect(() => {
    if (voice.on) void Voice.microphones().then(setMics);
  }, [voice.on, voice.hasMic]);
  // Choosing the talk key: the next key pressed (Escape keeps the old one).
  useEffect(() => {
    if (!capturing) return;
    const take = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") ctl.setKey(e.code);
      setCapturing(false);
    };
    window.addEventListener("keydown", take, true);
    return () => window.removeEventListener("keydown", take, true);
  }, [capturing, ctl, setCapturing]);
  const people = view.players.filter((p) => p.id !== me && !p.bot);
  return (
    <div className="ww-vpanel" role="dialog" aria-label="Voice settings">
      <div className="ww-vp-head">
        <b>Voice</b>
        <button type="button" className="linkish" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="ww-check">
        <input
          type="checkbox"
          checked={voice.on}
          onChange={(e) => (e.target.checked ? void ctl.join() : ctl.leave())}
        />
        Voice chat: hear the table, and talk
      </label>
      <fieldset className="ww-vp-mode" disabled={!voice.on}>
        <legend>Microphone</legend>
        <label>
          <input type="radio" name="ww-mic-mode" checked={voice.mode === "ptt"} onChange={() => ctl.setMode("ptt")} />
          Push to talk
        </label>
        <label>
          <input type="radio" name="ww-mic-mode" checked={voice.mode === "open"} onChange={() => ctl.setMode("open")} />
          Open mic
        </label>
      </fieldset>
      {voice.mode === "ptt" && (
        <div className="ww-vp-row">
          <span>Talk key</span>
          <button
            type="button"
            className={`btn ww-key${capturing ? " on" : ""}`}
            onClick={() => setCapturing(!capturing)}
            disabled={!voice.on}
          >
            {capturing ? "Press a key…" : keyName(voice.key)}
          </button>
        </div>
      )}
      {mics.length > 1 && (
        <div className="ww-vp-row">
          <label htmlFor="ww-mic-dev">Input</label>
          <select
            id="ww-mic-dev"
            value={voice.device ?? ""}
            onChange={(e) => void ctl.setDevice(e.target.value || null)}
          >
            <option value="">The system's microphone</option>
            {mics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {voice.error && <p className="ww-hint">{voice.error}</p>}
      <div className="ww-vp-row">
        <label htmlFor="ww-vol">Everyone</label>
        <input
          id="ww-vol"
          type="range"
          min={0}
          max={100}
          value={Math.round(voice.volume * 100)}
          onChange={(e) => ctl.setVolume(Number(e.target.value) / 100)}
        />
        <span className="ww-vp-n">{Math.round(voice.volume * 100)}%</span>
      </div>
      {people.length > 0 && (
        <>
          <h4>Each player</h4>
          <ul className="ww-vp-people">
            {people.map((p) => (
              <li key={p.id}>
                <PersonVoice id={p.id} name={p.name} voice={voice} ctl={ctl} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** One player's voice: whether it reaches this browser, how loud, and muting it. */
function PersonVoice({ id, name, voice, ctl }: { id: number; name: string; voice: VoiceState; ctl: Voice }) {
  const muted = voice.silenced.has(id);
  const level = Math.round((voice.people[String(id)] ?? 1) * 100);
  return (
    <div className={`ww-pv${muted ? " muted" : ""}`}>
      <span className="ww-pv-name">
        <i
          className={voice.speaking.has(id) ? "talk" : voice.linked.has(id) ? "on" : ""}
          title={voice.linked.has(id) ? "in the voice" : "not in the voice"}
        />
        {name}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={level}
        disabled={muted}
        aria-label={`${name}'s volume`}
        onChange={(e) => ctl.setPersonVolume(id, Number(e.target.value) / 100)}
      />
      <button
        type="button"
        className={`btn ww-pv-mute${muted ? " on" : ""}`}
        aria-pressed={muted}
        onClick={() => ctl.silence(id, !muted)}
        title={muted ? `Hear ${name} again` : `Stop hearing ${name}`}
      >
        <SpeakerIcon off={muted} />
        <span className="sr">{muted ? "Unmute" : "Mute"}</span>
      </button>
    </div>
  );
}

function SpeakerIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="ww-mic-ic" aria-hidden="true">
      <path d="M2.5 6h2.6L8.6 3v10L5.1 10H2.5z" />
      {off ? <path d="M10.6 6l3.6 4 M14.2 6l-3.6 4" /> : <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8" />}
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="ww-mic-ic" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v2 M8 12.4v2 M1.6 8h2 M12.4 8h2 M3.5 3.5l1.4 1.4 M11.1 11.1l1.4 1.4 M3.5 12.5l1.4-1.4 M11.1 4.9l1.4-1.4" />
    </svg>
  );
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="ww-mic-ic" aria-hidden="true">
      <path d="M8 1.8a2.2 2.2 0 0 0-2.2 2.2v4a2.2 2.2 0 0 0 4.4 0V4A2.2 2.2 0 0 0 8 1.8z M3.8 7.6a4.2 4.2 0 0 0 8.4 0 M8 11.8v2.6 M5.6 14.4h4.8" />
      {off && <path d="M2.4 2.4l11.2 11.2" />}
    </svg>
  );
}

/* ---------- the dock ---------- */

function Chat({ view, me, send }: { view: TableView; me: number; send: ReturnType<typeof useTable>["send"] }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const count = view.chat.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new line
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);
  const say = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !view.channel) return;
    send({ t: "chat", body });
    setText("");
  };
  const placeholder =
    view.channel === "wolves"
      ? "Whisper to the pack"
      : view.channel === "dead"
        ? "Talk with the dead"
        : view.channel === "all"
          ? "Say something to the village"
          : "It's night. Only the wolves can talk.";
  return (
    <div className="ww-chat">
      <ol ref={list}>
        {view.chat.length === 0 && <li className="ww-quiet">Nothing said yet.</li>}
        {view.chat.map((c) => (
          <li key={c.id} className={`ch-${c.channel}${c.from === me ? " mine" : ""}`}>
            {c.channel !== "all" && <span className="ww-chan">{c.channel === "wolves" ? "pack" : "ghosts"}</span>}
            <b>{c.from === me ? "you" : c.name}</b> {c.body}
          </li>
        ))}
      </ol>
      <form onSubmit={say} className="ww-say-form">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={!view.channel}
          maxLength={300}
          aria-label="Message"
        />
        <button type="submit" className="btn" disabled={!view.channel || !text.trim()}>
          Say
        </button>
      </form>
    </div>
  );
}

function Card({ view, name }: { view: TableView; name: (id: number) => string }) {
  const you = view.me;
  if (!you?.role) return <p className="ww-quiet">Your card comes when the game starts.</p>;
  const role = ROLES[you.role];
  const pack = view.players.filter((p) => p.id !== you.id && (p.role === "werewolf" || p.role === "wolfcub"));
  const lover = view.players.find((p) => p.lover && p.id !== you.id);
  return (
    <div className="ww-you">
      <div className={`ww-card ${role.team}`}>
        <RoleIcon of={you.role} className="big" />
        <div>
          <p className="ww-card-name">{role.name}</p>
          <p>{role.blurb}</p>
        </div>
      </div>
      {(you.role === "werewolf" || you.role === "wolfcub") && pack.length > 0 && (
        <p className="ww-fact">Your pack: {pack.map((p) => name(p.id)).join(", ")}.</p>
      )}
      {lover && <p className="ww-fact">You love {lover.name}.</p>}
      {view.notes.length > 1 && (
        <>
          <h4>What you know</h4>
          <ol className="ww-notes">
            {view.notes.slice(1).map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: notes only grow
              <li key={i}>{n.text}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Log({ view }: { view: TableView }) {
  const list = useRef<HTMLOListElement>(null);
  const count = view.log.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new line
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);
  return (
    <ol className="ww-log" ref={list}>
      {view.log.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the log only grows
        <li key={i} className={`lg-${l.kind}`}>
          {l.text}
        </li>
      ))}
    </ol>
  );
}

function Rules() {
  return (
    <div className="ww-rules">
      <p>
        Each night the roles wake one at a time, in the narrator's order: Cupid (the first night only), the Seer, the
        Bodyguard, the wolves, then the Witch. Each day the village finds out who died, talks, and votes someone out;
        the sheriff's vote counts twice and settles a tie. The village wins when the last wolf is gone; the wolves win
        when there are as many of them as everyone else.
      </p>
      <dl>
        {ROLE_ORDER.map((r) => (
          <div key={r}>
            <dt>
              <RoleIcon of={r} /> {ROLES[r].name}
            </dt>
            <dd>{ROLES[r].blurb}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- the table's settings ---------- */

const NIGHT = [10, 15, 20, 25, 30, 45, 60];
const TALK = [30, 60, 90, 120, 150, 180, 240, 300, 420, 600];
const VOTE = [15, 30, 45, 60, 90, 120];

function Settings({ view, host, send }: { view: TableView; host: boolean; send: ReturnType<typeof useTable>["send"] }) {
  const s = view.settings;
  const seated = view.players.length;
  const set = (patch: Partial<TableSettings>) => send({ t: "settings", settings: { ...s, ...patch } });
  const setRole = (r: Exclude<RoleId, "villager">, n: number) =>
    set({ auto: false, roles: { ...s.roles, [r]: Math.max(0, Math.min(ROLES[r].max, n)) } });
  // Villagers are everyone the roles leave over: at a full table, the seats the roles don't take. More villagers is
  // more seats.
  const specials = specialsIn(s.roles);
  const villagers = Math.max(0, s.seats - specials);
  const why = cannotStart(s, Math.max(seated, MIN_PLAYERS));
  const seconds = (n: number) => (n >= 60 ? `${n / 60} min` : `${n} s`);

  return (
    <div className="ww-set">
      {!host && <p className="ww-quiet">Only the host changes these.</p>}
      <fieldset disabled={!host}>
        <div className="ww-set-row">
          <span>Seats</span>
          <Stepper
            value={s.seats}
            min={Math.max(MIN_PLAYERS, seated)}
            max={MAX_PLAYERS}
            onChange={(n) => set({ seats: n })}
          />
        </div>
        <div className="ww-set-row">
          <span title="They play on their own: handy with few friends, or to try a game alone">Computer players</span>
          <Stepper
            value={view.players.filter((p) => p.bot).length}
            min={0}
            max={view.players.filter((p) => p.bot).length + Math.max(0, s.seats - seated)}
            onChange={(n) => send({ t: "bot", add: n > view.players.filter((p) => p.bot).length })}
          />
        </div>
        <Room view={view} send={send} />
        <div className="ww-set-head">
          <span>Roles</span>
          <label className="ww-check">
            <input
              type="checkbox"
              checked={s.auto}
              onChange={(e) =>
                set({
                  auto: e.target.checked,
                  roles: e.target.checked ? suggestRoles(Math.max(seated, MIN_PLAYERS)) : s.roles,
                })
              }
            />
            Choose for me
          </label>
        </div>
        <ul className="ww-roles">
          {ROLE_ORDER.filter((r): r is Exclude<RoleId, "villager"> => r !== "villager").map((r) => (
            <li key={r} className={s.roles[r] ? "in" : ""} title={ROLES[r].blurb}>
              <RoleIcon of={r} />
              <span>{ROLES[r].name}</span>
              {ROLES[r].max === 1 ? (
                <input
                  type="checkbox"
                  checked={s.roles[r] > 0}
                  onChange={(e) => setRole(r, e.target.checked ? 1 : 0)}
                  aria-label={ROLES[r].name}
                />
              ) : (
                <Stepper value={s.roles[r]} min={0} max={ROLES[r].max} onChange={(n) => setRole(r, n)} />
              )}
            </li>
          ))}
          <li className="in">
            <RoleIcon of="villager" />
            <span>Villagers</span>
            <Stepper
              value={villagers}
              min={Math.max(0, Math.max(MIN_PLAYERS, seated) - specials)}
              max={Math.max(0, MAX_PLAYERS - specials)}
              onChange={(n) => set({ seats: specials + n })}
            />
          </li>
        </ul>
        <p className="ww-hint ww-cast-note">
          A full table of {s.seats}: {specials} with a role, {villagers} {villagers === 1 ? "villager" : "villagers"}.
          {seated < s.seats ? " If fewer people sit down, there are fewer villagers." : ""}
        </p>
        {why && <p className="ww-hint">{why[0]?.toUpperCase() + why.slice(1)}.</p>}
        <div className="ww-set-row">
          <span title="How long each role has at night: the Seer, the Bodyguard, the wolves, the Witch">
            Each night turn
          </span>
          <Choice value={s.night} options={NIGHT} label={seconds} onChange={(n) => set({ night: n })} />
        </div>
        <div className="ww-set-row">
          <span>Talking</span>
          <Choice value={s.discussion} options={TALK} label={seconds} onChange={(n) => set({ discussion: n })} />
        </div>
        <div className="ww-set-row">
          <span>Voting</span>
          <Choice value={s.vote} options={VOTE} label={seconds} onChange={(n) => set({ vote: n })} />
        </div>
        <label className="ww-check">
          <input type="checkbox" checked={s.sheriff} onChange={(e) => set({ sheriff: e.target.checked })} />
          Elect a sheriff on the first day (their vote counts twice)
        </label>
        <label className="ww-check">
          <input type="checkbox" checked={s.reveal} onChange={(e) => set({ reveal: e.target.checked })} />
          Show a player's role when they die
        </label>
        <label className="ww-check">
          <input type="checkbox" checked={s.listed} onChange={(e) => set({ listed: e.target.checked })} />
          List this table on everyone's desktop
        </label>
      </fieldset>
    </div>
  );
}

/** Who can sit down: anyone with the link (and anyone, when it's listed), or only who has the host's password. */
function Room({ view, send }: { view: TableView; send: ReturnType<typeof useTable>["send"] }) {
  const [want, setWant] = useState<"open" | "password">(view.locked ? "password" : "open");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => setWant(view.locked ? "password" : "open"), [view.locked]);
  const short = password.trim().length > 0 && password.trim().length < 4;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (password.trim().length < 4) return;
    send({ t: "lock", password: password.trim() });
    setPassword("");
  };
  return (
    <div className="ww-room">
      <span className="ww-room-q">Who can sit down</span>
      <div className="ww-room-opts" role="radiogroup" aria-label="Who can sit down">
        <label className={want === "open" ? "on" : ""}>
          <input
            type="radio"
            name="ww-room"
            checked={want === "open"}
            onChange={() => {
              setWant("open");
              if (view.locked) send({ t: "lock", password: null });
            }}
          />
          Anyone
        </label>
        <label className={want === "password" ? "on" : ""}>
          <input type="radio" name="ww-room" checked={want === "password"} onChange={() => setWant("password")} />
          <LockIcon /> With a password
        </label>
      </div>
      {want === "password" && (
        <form className="ww-pass" onSubmit={save}>
          <input
            type={shown ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={view.locked ? "A password is set. Type a new one to change it" : "Four to forty characters"}
            aria-label="Table password"
            maxLength={40}
            autoComplete="new-password"
          />
          <button type="button" className="linkish" onClick={() => setShown(!shown)} aria-pressed={shown}>
            {shown ? "Hide" : "Show"}
          </button>
          <button type="submit" className="btn" disabled={password.trim().length < 4}>
            {view.locked ? "Change" : "Set"}
          </button>
        </form>
      )}
      <p className="ww-hint">
        {short
          ? "At least four characters."
          : view.locked
            ? "Everyone sitting here stays. Newcomers type the password to sit down; tell your friends."
            : want === "password"
              ? "Set it, then tell your friends. The table only keeps a scrambled copy."
              : "Anyone with the link can sit down."}
      </p>
    </div>
  );
}

/** A table with a password, for someone not sitting at it yet. */
function Locked({ code, onOpen, onLeave }: { code: string; onOpen: () => void; onLeave: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await unlockTable(code, password);
    setBusy(false);
    if ("ok" in r) onOpen();
    else setError(r.error);
  };
  return (
    <div className="body ww ww-gone ww-locked">
      <LockIcon className="big" />
      <p>This table has a password. Ask the host for it.</p>
      <form className="ww-pass" onSubmit={submit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="The table's password"
          placeholder="Password"
          maxLength={40}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the only thing to do here
          autoFocus
        />
        <button type="submit" className="btn ww-primary" disabled={busy || password.trim().length < 4}>
          {busy ? "Knocking…" : "Sit down"}
        </button>
      </form>
      {error && <p className="err">{error[0]?.toUpperCase() + error.slice(1)}.</p>}
      <button type="button" className="linkish" onClick={onLeave}>
        Back to the tables
      </button>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`ww-lock${className ? ` ${className}` : ""}`} aria-hidden="true">
      <path d="M4.5 7.2V5.4a3.5 3.5 0 0 1 7 0v1.8 M3.2 7.2h9.6v7H3.2z M8 9.8v2" />
    </svg>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <span className="ww-step">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="fewer">
        −
      </button>
      <span className="ww-n">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="more">
        +
      </button>
    </span>
  );
}

function Choice({
  value,
  options,
  label,
  onChange,
}: {
  value: number;
  options: number[];
  label: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {all.map((n) => (
        <option key={n} value={n}>
          {label(n)}
        </option>
      ))}
    </select>
  );
}
