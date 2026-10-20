"use client";

import type { CatStats, Me } from "@4me/shared";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiSend } from "@/lib/api";
import { saveInk } from "@/lib/member-actions";
import { IconHeart } from "../Icons";
import * as N from "./needs";
import { BOWL, FISH, FRAMES, type FrameName, H, paint, W, YARN } from "./sprites";
import "./ink.css";

const SCALE = 3;
const CAT_W = W * SCALE;
/** In the eating frame the bowl starts 15 pixels into the sprite. */
const BOWL_OFFSET = 15 * SCALE;

type Mode = "walk" | "run" | "sit" | "groom" | "happy" | "sleep" | "eat" | "crouch" | "jump";
type Task =
  | { kind: "feed"; bowlX: number }
  | { kind: "play"; kicks: number }
  | { kind: "call" }
  | { kind: "beg" }
  | null;
type Pop = { id: number; kind: "heart" | "fish"; dx: number };
type Press = { lx: number; ly: number; dist: number; strokes: number; stroking: boolean; held: boolean; timer: number };

export type InkEvent = "buzz" | "note" | "call" | "feed" | "play";

/** Let the rest of the desktop poke Ink: a buzz startles her, a note earns her a snack. */
export function nudgeInk(event: InkEvent) {
  window.dispatchEvent(new CustomEvent<InkEvent>("ink", { detail: event }));
}

function Sprite({ rows, className }: { rows: readonly string[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = rows[0]?.length ?? 1;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) paint(ctx, rows);
  }, [rows]);
  return <canvas ref={ref} width={w} height={rows.length} className={className} />;
}

const STORE = "4me-ink";

type InkProps = { awake: boolean; stats: CatStats; onStats: (s: CatStats) => void; me: Me | null };

export function Ink({ awake, stats, onStats, me }: InkProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [menuLeft, setMenuLeft] = useState<number | null>(null);
  const [bowl, setBowl] = useState<{ x: number; visible: boolean } | null>(null);
  const [fishAt, setFishAt] = useState<number | null>(null);
  const [yarnX, setYarnX] = useState<number | null>(null);
  const [needs, setNeeds] = useState<N.Needs>(() => N.fresh(0));

  const needsRef = useRef(needs);
  const firstItem = useRef<HTMLButtonElement>(null);
  const awakeRef = useRef(awake);
  const yarnRef = useRef<number | null>(null);
  const bubbleTimer = useRef(0);
  const popId = useRef(0);
  const st = useRef({
    x: 200,
    dir: 1,
    mode: "sit" as Mode,
    target: 200,
    speed: 40,
    until: 0,
    task: null as Task,
    nextBlink: 0,
    blinkUntil: 0,
    frame: "" as FrameName | "",
    press: null as Press | null,
  });

  useEffect(() => {
    awakeRef.current = awake;
  }, [awake]);

  /* ---------- small helpers ---------- */
  const say = useCallback((text: string, ms = 2600) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const pop = useCallback((kind: Pop["kind"], n = 1) => {
    const fresh = Array.from({ length: n }, (_, i) => ({ id: ++popId.current, kind, dx: (i - (n - 1) / 2) * 16 }));
    setPops((p) => [...p, ...fresh]);
    window.setTimeout(() => setPops((p) => p.filter((x) => !fresh.includes(x))), 1300);
  }, []);

  const signedIn = useRef(false);
  const syncTimer = useRef(0);
  const saveNeeds = useCallback((next: N.Needs) => {
    needsRef.current = next;
    setNeeds(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // storage can be off (private windows); Ink just forgets between visits
    }
    // Members keep Ink in their account too, so she is the same cat on every device. Saves are batched.
    if (signedIn.current) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void saveInk(needsRef.current), 4000);
    }
  }, []);

  useEffect(() => {
    signedIn.current = Boolean(me);
    if (!me?.ink) return;
    const now = Date.now();
    const local = N.decay(needsRef.current, now);
    const remote = N.decay(me.ink, now);
    // Whichever copy was cared for most recently wins.
    if (me.ink.at > needsRef.current.at) saveNeeds(remote);
    else saveNeeds(local);
  }, [me, saveNeeds]);

  const report = useCallback(
    async (action: "pet" | "feed" | "play") => {
      const res = await apiSend<CatStats>(`/cat/${action}`);
      if (res.ok) onStats(res.data);
    },
    [onStats],
  );

  const setMode = useCallback((mode: Mode, ms = 0) => {
    const s = st.current;
    s.mode = mode;
    s.until = performance.now() + ms;
    if (root.current) root.current.dataset.mode = mode;
  }, []);

  const walkTo = useCallback(
    (x: number, speed = 40, mode: Mode = "walk") => {
      const s = st.current;
      s.target = Math.max(8, Math.min(window.innerWidth - CAT_W - 8, x));
      s.speed = speed;
      setMode(mode);
    },
    [setMode],
  );

  const approach = (x: number) => {
    const s = st.current;
    return x > s.x ? x - CAT_W + 10 : x + 14;
  };

  /* ---------- what Ink does ---------- */
  const petOnce = useCallback(() => {
    pop("heart", 3);
    if (!awakeRef.current) {
      say("zzz… come back after dark.");
      return;
    }
    const next = N.pet(needsRef.current);
    saveNeeds(next);
    setMode("happy", 1400);
    say(N.lineFor(N.moodOf(next), Math.random()));
    void report("pet");
  }, [pop, say, saveNeeds, setMode, report]);

  const stroke = useCallback(() => {
    saveNeeds(N.pet(needsRef.current, 2));
    pop("heart");
    if (awakeRef.current && !st.current.task) setMode("happy", 700);
  }, [pop, saveNeeds, setMode]);

  const feedNow = useCallback(() => {
    setMenuLeft(null);
    const s = st.current;
    if (!awakeRef.current) return say("zzz… (smells fish)");
    if (N.isFull(needsRef.current)) return say("full. maybe later.");
    if (s.task?.kind === "feed") return;
    const x = Math.max(BOWL_OFFSET + 12, Math.min(window.innerWidth - 40, s.x + (s.dir > 0 ? 110 : -50)));
    setBowl({ x, visible: true });
    setFishAt(x);
    window.setTimeout(() => setFishAt(null), 700);
    s.task = { kind: "feed", bowlX: x };
    say("!! fish !!", 1200);
    walkTo(x - BOWL_OFFSET, 120, "run");
  }, [say, walkTo]);

  const playNow = useCallback(() => {
    setMenuLeft(null);
    const s = st.current;
    if (!awakeRef.current) return say("zzz… too sleepy to play.");
    const far = s.x > window.innerWidth / 2 ? s.x - 260 : s.x + 260;
    const x = Math.max(20, Math.min(window.innerWidth - 40, far));
    yarnRef.current = x;
    setYarnX(x);
    s.task = { kind: "play", kicks: 0 };
    s.dir = x > s.x ? 1 : -1;
    setMode("crouch", 600);
  }, [say, setMode]);

  const callNow = useCallback(() => {
    setMenuLeft(null);
    if (!awakeRef.current) return say("zzz… not now.");
    st.current.task = { kind: "call" };
    walkTo(window.innerWidth / 2 - CAT_W / 2, 120, "run");
  }, [say, walkTo]);

  const snack = useCallback(() => {
    if (!awakeRef.current) return say("zzz… (smells fish)");
    saveNeeds(N.feed(needsRef.current, 10));
    pop("fish");
    say("nom. thank you for the note.");
    if (!st.current.task) setMode("happy", 1200);
    void report("feed");
  }, [pop, report, saveNeeds, say, setMode]);

  const startle = useCallback(() => {
    if (!awakeRef.current || st.current.task) return;
    setMode("jump", 900);
    say("!!", 1200);
  }, [say, setMode]);

  /* ---------- the loop ---------- */
  // biome-ignore lint/correctness/useExhaustiveDependencies: set up once; it reads live values through refs
  useEffect(() => {
    const s = st.current;
    s.x = s.target = Math.round(window.innerWidth * 0.45);
    saveNeeds(N.load(safeGet(STORE), Date.now()));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ctx = canvas.current?.getContext("2d");

    const arrive = () => {
      const task = s.task;
      if (task?.kind === "feed") {
        s.dir = 1;
        s.x = task.bowlX - BOWL_OFFSET;
        setBowl({ x: task.bowlX, visible: false });
        setMode("eat", 2600);
        return;
      }
      if (task?.kind === "play") return setMode("crouch", 450);
      if (task?.kind === "call") {
        s.task = null;
        setMode("sit", 3000);
        return say("mrrp?");
      }
      if (task?.kind === "beg") {
        s.task = null;
        setMode("sit", 4000);
        return say(N.lineFor(N.moodOf(needsRef.current), Math.random()));
      }
      setMode("sit", 2500 + Math.random() * 4000);
    };

    const idleDone = () => {
      const task = s.task;
      if (task?.kind === "feed" && s.mode === "eat") {
        s.task = null;
        setBowl(null);
        saveNeeds(N.feed(needsRef.current));
        pop("heart", 2);
        say("nom nom. thank you.");
        void report("feed");
        return setMode("groom", 1800);
      }
      if (task?.kind === "play" && s.mode === "crouch") {
        if (task.kicks >= 3) {
          s.task = null;
          yarnRef.current = null;
          setYarnX(null);
          saveNeeds(N.play(needsRef.current));
          pop("heart", 3);
          say("again! …no. nap.");
          void report("play");
          return setMode("happy", 1600);
        }
        const yarn = yarnRef.current ?? s.x;
        if (task.kicks > 0) {
          const away = yarn + (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 160);
          const nx = Math.max(20, Math.min(window.innerWidth - 40, away));
          yarnRef.current = nx;
          setYarnX(nx);
        }
        task.kicks++;
        return walkTo(approach(yarnRef.current ?? yarn), 140, "run");
      }
      if (s.mode !== "sit") return setMode("sit", 1500 + Math.random() * 2500);
      const mood = N.moodOf(needsRef.current);
      const r = Math.random();
      if ((mood === "hungry" || mood === "starving") && r < 0.35) {
        s.task = { kind: "beg" };
        return walkTo(70);
      }
      if (mood === "lonely" && r < 0.3) {
        setMode("sit", 3500);
        return say(N.lineFor("lonely", Math.random()));
      }
      if (r < 0.2) return setMode("groom", 2200);
      if (r < 0.8) {
        const max = window.innerWidth - CAT_W - 10;
        let t = 10 + Math.random() * (max - 10);
        if (Math.abs(t - s.x) < 120) t = s.x > max / 2 ? s.x - 180 : s.x + 180;
        return walkTo(t);
      }
      setMode("sit", 3000);
    };

    const draw = (f: FrameName) => {
      if (!ctx || f === s.frame) return;
      ctx.clearRect(0, 0, W, H);
      paint(ctx, FRAMES[f]);
      s.frame = f;
    };

    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (!awakeRef.current) {
        if (s.mode !== "sleep" && !s.task) setMode("sleep");
      } else if (s.mode === "sleep") {
        setMode("sit", 1500);
        say("*yawn*");
      }

      if (s.mode === "walk" || s.mode === "run") {
        const d = s.target - s.x;
        s.dir = d >= 0 ? 1 : -1;
        const step = reduce.matches ? Math.abs(d) : s.speed * dt;
        if (Math.abs(d) <= step) {
          s.x = s.target;
          arrive();
        } else s.x += step * s.dir;
      } else if (s.mode !== "sleep" && t > s.until) idleDone();

      let frame: FrameName;
      if (s.mode === "walk" || s.mode === "run") {
        frame = Math.floor(t / (s.mode === "run" ? 90 : 190)) % 2 ? "walkB" : "walkA";
      } else if (s.mode === "sit" || s.mode === "jump") {
        if (t > s.nextBlink) {
          s.blinkUntil = t + 140;
          s.nextBlink = t + 2500 + Math.random() * 3500;
        }
        frame = t < s.blinkUntil ? "blink" : "sit";
      } else frame = s.mode;
      draw(frame);

      if (root.current) {
        root.current.style.transform = `translateX(${s.x.toFixed(1)}px)`;
        root.current.classList.toggle("flip", s.dir < 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onEvent = (e: Event) => {
      const kind = (e as CustomEvent<InkEvent>).detail;
      if (kind === "buzz") startle();
      else if (kind === "note") snack();
      else if (kind === "call") callNow();
      else if (kind === "feed") feedNow();
      else if (kind === "play") playNow();
    };
    window.addEventListener("ink", onEvent);
    const decayTimer = window.setInterval(() => saveNeeds(N.decay(needsRef.current, Date.now())), 60_000);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("ink", onEvent);
      window.clearInterval(decayTimer);
    };
  }, []);

  useEffect(() => {
    if (menuLeft === null) return;
    firstItem.current?.focus();
    const close = (e: globalThis.KeyboardEvent | MouseEvent) => {
      if (e instanceof globalThis.KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".ink-menu")) {
        setMenuLeft(null);
      }
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [menuLeft]);

  /* ---------- hands on Ink ---------- */
  const openMenu = () => setMenuLeft(Math.max(8, Math.min(window.innerWidth - 248, st.current.x - 88)));

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const press: Press = { lx: e.clientX, ly: e.clientY, dist: 0, strokes: 0, stroking: false, held: false, timer: 0 };
    press.timer = window.setTimeout(() => {
      if (!press.stroking) {
        press.held = true;
        openMenu();
      }
    }, 550);
    st.current.press = press;
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = st.current.press;
    if (!p) return;
    p.dist += Math.hypot(e.clientX - p.lx, e.clientY - p.ly);
    p.lx = e.clientX;
    p.ly = e.clientY;
    if (p.dist > 14 && !p.stroking) {
      p.stroking = true;
      window.clearTimeout(p.timer);
    }
    if (p.stroking && p.dist > (p.strokes + 1) * 60) {
      p.strokes++;
      stroke();
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = st.current.press;
    st.current.press = null;
    if (!p || e.button === 2) return;
    window.clearTimeout(p.timer);
    if (p.held) return;
    if (p.stroking) {
      if (p.strokes >= 3) {
        say(awakeRef.current ? "purrrrrrr" : "purr… zzz");
        void report("pet");
      }
      return;
    }
    petOnce();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openMenu();
    }
  };

  const mood = N.moodOf(needs);
  const moodText = !awake ? "asleep" : mood === "content" ? "content" : mood;

  return (
    <>
      <div className="ink" ref={root} data-mode="sit">
        <button
          type="button"
          className="ink-btn"
          aria-label={`Ink the cat, ${moodText}. Click to pet, drag to stroke, right-click or Shift+F10 for more.`}
          aria-haspopup="menu"
          aria-expanded={menuLeft !== null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            st.current.press = null;
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu();
          }}
          onClick={(e) => {
            if (e.detail === 0) petOnce();
          }}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvas} width={W} height={H} />
        </button>
        {bubble && (
          <span className="ink-bubble" role="status">
            {bubble}
          </span>
        )}
        {!awake && (
          <span className="ink-zz" aria-hidden="true">
            z
          </span>
        )}
        {pops.map((p) =>
          p.kind === "heart" ? (
            <IconHeart key={p.id} className="ink-pop" />
          ) : (
            <span key={p.id} className="ink-pop" style={{ width: 24 }}>
              <Sprite rows={FISH} />
            </span>
          ),
        )}
      </div>

      {bowl?.visible && (
        <div className="ink-prop ink-bowl" style={{ transform: `translateX(${bowl.x}px)` }}>
          <Sprite rows={BOWL} />
        </div>
      )}
      {fishAt !== null && (
        <div className="ink-fish" style={{ left: fishAt, bottom: "calc(var(--task-h) + 6px)" }}>
          <Sprite rows={FISH} />
        </div>
      )}
      {yarnX !== null && (
        <div className="ink-prop ink-yarn" style={{ transform: `translateX(${yarnX}px)` }} key={yarnX}>
          <Sprite rows={YARN} />
        </div>
      )}

      {menuLeft !== null && (
        <div className="ink-menu" style={{ left: menuLeft }} role="menu" aria-label="Ink">
          <header>
            <b>Ink</b>
            <span>{moodText}</span>
          </header>
          <div className="ink-meters">
            <div className="ink-meter">
              <span>Fed</span>
              <i style={{ "--v": `${needs.hunger}%`, "--c": "#8fc7ff" } as CSSProperties} />
              <span>{Math.round(needs.hunger)}%</span>
            </div>
            <div className="ink-meter">
              <span>Happy</span>
              <i style={{ "--v": `${needs.joy}%`, "--c": "#ff8fa8" } as CSSProperties} />
              <span>{Math.round(needs.joy)}%</span>
            </div>
          </div>
          <ul>
            <li>
              <button type="button" role="menuitem" ref={firstItem} onClick={feedNow}>
                Give her a fish <small>{N.isFull(needs) ? "full" : "+fed"}</small>
              </button>
            </li>
            <li>
              <button type="button" role="menuitem" onClick={playNow}>
                Play with the yarn <small>+happy</small>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuLeft(null);
                  petOnce();
                }}
              >
                Pet her <small>or drag across her</small>
              </button>
            </li>
            <li>
              <button type="button" role="menuitem" onClick={callNow}>
                Call her over
              </button>
            </li>
          </ul>
          <p className="ink-world">
            Readers have petted Ink <b>{stats.pets.toLocaleString("en")}</b> times, fed her{" "}
            <b>{stats.fish.toLocaleString("en")}</b> fish and played <b>{stats.plays.toLocaleString("en")}</b> games.
          </p>
        </div>
      )}
    </>
  );
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
