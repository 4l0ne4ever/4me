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
import * as Sound from "./sounds";
import { BOWL, FISH, FRAMES, type FrameName, H, paint, W, YARN } from "./sprites";
import { CLIMB_INSET, findPlat, GROUND, landing, type Plat, plan, readPlatforms, type Step } from "./world";
import "./ink.css";

const SCALE = 3;
const CAT_W = W * SCALE;
/** In the eating frame the bowl starts 15 pixels into the sprite. */
const BOWL_OFFSET = 15 * SCALE;

type Mode =
  | "walk"
  | "run"
  | "sit"
  | "groom"
  | "happy"
  | "sleep"
  | "eat"
  | "crouch"
  | "jump"
  | "held"
  | "fall"
  | "climb";
type Task = { kind: "feed" } | { kind: "play"; kicks: number } | { kind: "call" } | { kind: "beg" } | null;
type Pop = { id: number; kind: "heart" | "fish"; dx: number };
type Press = {
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  dist: number;
  strokes: number;
  stroking: boolean;
  held: boolean;
  timer: number;
  /** Lifted off the taskbar: where the pointer holds her, and where the ground is on screen. */
  carry: { dx: number; dy: number; ground: number } | null;
};

/** A bowl with a fish, dropped somewhere on the desktop: where it is, and the surface it landed on (null while falling). */
type Food = { x: number; y: number; vy: number; on: string | null; platLeft: number };
/** Where she is going, and how. */
type Goal = { on: string; x: number; mode: Mode };

/** Pixels per second squared when she drops. */
const GRAVITY = 2600;

export type InkEvent = "buzz" | "note" | "call" | "feed" | "play";

/** Let the rest of the desktop poke Ink: a buzz startles her, a note earns her a snack. */
export function nudgeInk(event: InkEvent) {
  window.dispatchEvent(new CustomEvent<InkEvent>("ink", { detail: event }));
}

/** Drops a bowl of fish at this point on the screen: it falls onto whatever is below, and Ink goes to it. */
export function feedInkAt(x: number, y: number) {
  window.dispatchEvent(new CustomEvent("ink-feed", { detail: { x, y } }));
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
  const [menuLift, setMenuLift] = useState(0);
  const [food, setFood] = useState(false);
  const foodRef = useRef<Food | null>(null);
  const foodEl = useRef<HTMLDivElement>(null);
  const goRef = useRef<(on: string, x: number, speed?: number, mode?: Mode) => void>(() => undefined);
  const [yarnX, setYarnX] = useState<number | null>(null);
  const [needs, setNeeds] = useState<N.Needs>(() => N.fresh(0));
  const [sound, setSound] = useState(true);

  const needsRef = useRef(needs);
  const firstItem = useRef<HTMLButtonElement>(null);
  const awakeRef = useRef(awake);
  const yarnRef = useRef<number | null>(null);
  const bubbleTimer = useRef(0);
  const popId = useRef(0);
  const st = useRef({
    x: 200,
    /** Height above the taskbar while carried or falling, and the falling speed. */
    y: 0,
    vy: 0,
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
    /** The surface she stands on (null in the air), and where it was last frame, so she rides along with it. */
    on: GROUND as string | null,
    platLeft: 0,
    route: [] as Step[],
    goal: null as Goal | null,
    climb: null as { id: string; side: "left" | "right" } | null,
  });

  useEffect(() => {
    awakeRef.current = awake;
  }, [awake]);

  useEffect(() => setSound(Sound.soundOn()), []);

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

  const approach = (x: number) => {
    const s = st.current;
    return x > s.x ? x - CAT_W + 10 : x + 14;
  };

  /* ---------- what Ink does ---------- */
  const petOnce = useCallback(() => {
    pop("heart", 3);
    if (!awakeRef.current) {
      Sound.mew();
      say("zzz… come back after dark.");
      return;
    }
    const next = N.pet(needsRef.current);
    saveNeeds(next);
    (Math.random() < 0.6 ? Sound.meow : Sound.mrrp)();
    setMode("happy", 1400);
    say(N.lineFor(N.moodOf(next), Math.random()));
    void report("pet");
  }, [pop, say, saveNeeds, setMode, report]);

  const stroke = useCallback(
    (strokes: number) => {
      saveNeeds(N.pet(needsRef.current, 2));
      pop("heart");
      if (strokes >= 3) Sound.purr();
      if (awakeRef.current && !st.current.task) setMode("happy", 700);
    },
    [pop, saveNeeds, setMode],
  );

  /** A bowl of fish dropped from a point on the screen; she goes wherever it lands. */
  const dropFood = useCallback(
    (cx: number, cy: number) => {
      setMenuLeft(null);
      if (!awakeRef.current) return say("zzz… (smells fish)");
      if (N.isFull(needsRef.current)) return say("full. maybe later.");
      if (foodRef.current) return say("one fish at a time.");
      const taskTop = document.querySelector(".task")?.getBoundingClientRect().top ?? window.innerHeight - 48;
      foodRef.current = {
        x: Math.max(BOWL_OFFSET + 4, Math.min(window.innerWidth - 30, cx - 12)),
        y: Math.max(0, taskTop - cy),
        vy: 0,
        on: null,
        platLeft: 0,
      };
      setFood(true);
      st.current.task = { kind: "feed" };
      Sound.mrrp();
      say("!! fish !!", 1200);
    },
    [say],
  );

  /** From her menu: the bowl drops just in front of her, on whatever she is standing on. */
  const feedNow = useCallback(() => {
    const s = st.current;
    const taskTop = document.querySelector(".task")?.getBoundingClientRect().top ?? window.innerHeight - 48;
    dropFood(s.x + (s.dir > 0 ? CAT_W + 50 : -40), taskTop - s.y - 140);
  }, [dropFood]);

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
    goRef.current(GROUND, window.innerWidth / 2 - CAT_W / 2, 120, "run");
  }, [say]);

  const snack = useCallback(() => {
    if (!awakeRef.current) return say("zzz… (smells fish)");
    saveNeeds(N.feed(needsRef.current, 10));
    pop("fish");
    Sound.crunch(3);
    say("nom. thank you for the note.");
    if (!st.current.task) setMode("happy", 1200);
    void report("feed");
  }, [pop, report, saveNeeds, say, setMode]);

  const startle = useCallback(() => {
    if (!awakeRef.current || st.current.task) return;
    if (st.current.mode === "held" || st.current.mode === "fall") return;
    Sound.yowl();
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
    const width = () => window.innerWidth;
    const surfaces = () => readPlatforms(CAT_W);

    /** Keeps her feet on the surface she is on: whole, over its span. */
    const clampTo = (x: number) => {
      const p = s.on && s.on !== GROUND ? findPlat(surfaces(), s.on, width()) : null;
      if (!p) return Math.max(8, Math.min(width() - CAT_W - 8, x));
      return Math.max(p.left - CAT_W / 2 + 4, Math.min(p.right - CAT_W / 2 - 4, x));
    };

    /** Starts the next leg of the trip, or, with none left, does whatever she went there for. */
    const nextStep = () => {
      const step = s.route.shift();
      if (!step) {
        s.goal = null;
        return arrive();
      }
      if (step.kind === "walk") {
        s.target = clampTo(step.x);
        return setMode(s.goal?.mode ?? "walk");
      }
      s.on = null;
      if (step.kind === "drop") {
        s.vy = -300; // a little hop off the edge
        return setMode("fall");
      }
      s.climb = { id: step.id, side: step.side };
      setMode("climb");
    };

    /** Sets off for a spot on a surface, by whatever way gets there. */
    const go = (on: string, x: number, speed = 40, mode: Mode = "walk") => {
      s.goal = { on, x, mode };
      s.speed = speed;
      s.route = s.on ? plan({ on: s.on, x: s.x }, { on, x }, surfaces(), width(), CAT_W) : [{ kind: "walk", x }];
      nextStep();
    };
    goRef.current = go;

    /** Heads for the fish if it has landed somewhere. */
    const goEat = () => {
      const f = foodRef.current;
      if (f?.on) go(f.on, f.x - BOWL_OFFSET, 120, "run");
    };

    const arrive = () => {
      const task = s.task;
      if (task?.kind === "feed") {
        const f = foodRef.current;
        if (!f) {
          s.task = null;
          return setMode("sit", 1500);
        }
        // The fish can ride off on a window, or fall, while she walks: then she follows it.
        if (f.on !== s.on || Math.abs(s.x - (f.x - BOWL_OFFSET)) > 8) return f.on ? goEat() : setMode("sit", 400);
        s.dir = 1;
        s.x = f.x - BOWL_OFFSET;
        foodRef.current = null;
        setFood(false);
        setMode("eat", 2600);
        Sound.crunch(9);
        return;
      }
      if (task?.kind === "play") return setMode("crouch", 450);
      if (task?.kind === "call") {
        s.task = null;
        setMode("sit", 3000);
        Sound.mrrp();
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
        saveNeeds(N.feed(needsRef.current));
        pop("heart", 2);
        say("nom nom. thank you.");
        void report("feed");
        return setMode("groom", 1800);
      }
      if (task?.kind === "feed") return goEat();
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
          const nx = Math.max(20, Math.min(width() - 40, away));
          yarnRef.current = nx;
          setYarnX(nx);
        }
        task.kicks++;
        if (task.kicks > 1) Sound.mrrp();
        return go(GROUND, approach(yarnRef.current ?? yarn), 140, "run");
      }
      if (s.mode !== "sit") return setMode("sit", 1500 + Math.random() * 2500);
      const mood = N.moodOf(needsRef.current);
      const r = Math.random();
      if ((mood === "hungry" || mood === "starving") && r < 0.35) {
        s.task = { kind: "beg" };
        return go(GROUND, 70);
      }
      if (mood === "lonely" && r < 0.3) {
        setMode("sit", 3500);
        return say(N.lineFor("lonely", Math.random()));
      }
      if (r < 0.2) return setMode("groom", 2200);
      if (r < 0.8) {
        const up = surfaces();
        // Now and then she climbs onto a window or a roof, and from up there, now and then, she hops down again.
        if (s.on === GROUND && up.length > 0 && Math.random() < 0.35) {
          const p = up[Math.floor(Math.random() * up.length)]!;
          return go(p.id, p.left + Math.random() * Math.max(0, p.right - p.left - CAT_W));
        }
        if (s.on !== GROUND && Math.random() < 0.3) return go(GROUND, 10 + Math.random() * (width() - CAT_W - 20));
        const here = s.on ? findPlat(up, s.on, width()) : null;
        const lo = here && here.id !== GROUND ? here.left : 10;
        const hi = here && here.id !== GROUND ? here.right - CAT_W : width() - CAT_W - 10;
        let t = lo + Math.random() * Math.max(0, hi - lo);
        if (Math.abs(t - s.x) < 60 && hi - lo > 200) t = s.x > (lo + hi) / 2 ? s.x - 140 : s.x + 140;
        return go(s.on ?? GROUND, t);
      }
      setMode("sit", 3000);
    };

    /** She has come down onto a surface: carry on with the trip, or shake it off. */
    const land = (p: Plat, speed: number) => {
      s.y = p.y;
      s.vy = 0;
      s.on = p.id;
      s.platLeft = p.left;
      if (s.goal) {
        Sound.thud();
        s.route = plan({ on: p.id, x: s.x }, s.goal, surfaces(), width(), CAT_W);
        return nextStep();
      }
      const hard = speed > 900;
      Sound.thud();
      setMode("crouch", hard ? 700 : 400);
      if (hard) say(awakeRef.current ? "!!" : "…mrr. zzz", 1200);
      // A fish is still waiting somewhere: she remembers it.
      if (foodRef.current && awakeRef.current) s.task = { kind: "feed" };
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
      const up = surfaces();
      const carried = s.mode === "held" || s.mode === "fall";
      if (!awakeRef.current) {
        if (s.mode !== "sleep" && !s.task && !carried && s.mode !== "climb" && t > s.until) setMode("sleep");
      } else if (s.mode === "sleep") {
        setMode("sit", 1500);
        say("*yawn*");
      }

      // Standing on a window: she rides along when it is dragged, and drops when it closes or slides away.
      if (s.on && s.on !== GROUND && s.mode !== "held") {
        const p = findPlat(up, s.on, width());
        const cx = s.x + CAT_W / 2;
        if (!p || cx < p.left - 6 || cx > p.right + 6) {
          s.on = null;
          s.vy = 0;
          s.route = [];
          setMode("fall");
        } else {
          const d = p.left - s.platLeft;
          s.x += d;
          s.target += d;
          s.platLeft = p.left;
          s.y = p.y;
        }
      }

      if (s.mode === "fall") {
        const from = s.y;
        s.vy += GRAVITY * dt;
        s.y -= s.vy * dt;
        const cx = s.x + CAT_W / 2;
        const hit = reduce.matches
          ? landing(up, cx, from, Number.NEGATIVE_INFINITY, width())
          : s.vy > 0
            ? landing(up, cx, from, s.y, width())
            : null;
        if (hit) land(hit, s.vy);
      } else if (s.mode === "climb" && s.climb) {
        const p = findPlat(up, s.climb.id, width());
        if (!p) {
          s.climb = null;
          s.vy = 0;
          setMode("fall");
        } else {
          s.x = s.climb.side === "left" ? p.left - CLIMB_INSET.left : p.right - CLIMB_INSET.right;
          // A leap up to the bottom of the wall, then paw over paw.
          const speed = s.y < (p.bottom ?? 0) ? 560 : 130;
          s.y = reduce.matches ? p.y : Math.min(p.y, s.y + speed * dt);
          if (s.y >= p.y) {
            const side = s.climb.side;
            s.climb = null;
            s.on = p.id;
            s.platLeft = p.left;
            s.x = side === "left" ? p.left - CAT_W / 2 + 12 : p.right - CAT_W / 2 - 12;
            s.target = s.x;
            s.dir = side === "left" ? 1 : -1;
            nextStep();
          }
        }
      } else if (s.mode === "held") {
        // follows the pointer; nothing else to do
      } else if (s.mode === "walk" || s.mode === "run") {
        const d = s.target - s.x;
        s.dir = d >= 0 ? 1 : -1;
        const step = reduce.matches ? Math.abs(d) : s.speed * dt;
        if (Math.abs(d) <= step) {
          s.x = s.target;
          nextStep();
        } else s.x += step * s.dir;
      } else if (s.mode !== "sleep" && t > s.until) idleDone();

      // The fish falls too, lands on whatever is under it, and rides along with it.
      const f = foodRef.current;
      if (f) {
        if (!f.on) {
          const from = f.y;
          f.vy += GRAVITY * dt;
          f.y -= f.vy * dt;
          const hit = landing(up, f.x + 12, from, reduce.matches ? Number.NEGATIVE_INFINITY : f.y, width());
          if (hit) {
            f.on = hit.id;
            f.y = hit.y;
            f.vy = 0;
            f.platLeft = hit.left;
            if (s.task?.kind === "feed" && s.mode !== "held" && s.mode !== "eat") goEat();
          }
        } else if (f.on !== GROUND) {
          const p = findPlat(up, f.on, width());
          if (!p) {
            f.on = null;
          } else {
            f.x += p.left - f.platLeft;
            f.platLeft = p.left;
            f.y = p.y;
          }
        }
        if (foodEl.current) foodEl.current.style.transform = `translate(${f.x.toFixed(1)}px, ${(-f.y).toFixed(1)}px)`;
      }

      let frame: FrameName;
      if (s.mode === "held") frame = "happy";
      else if (s.mode === "fall") frame = "crouch";
      else if (s.mode === "walk" || s.mode === "run" || s.mode === "climb") {
        const pace = s.mode === "run" ? 90 : s.mode === "climb" ? 140 : 190;
        frame = Math.floor(t / pace) % 2 ? "walkB" : "walkA";
      } else if (s.mode === "sit" || s.mode === "jump") {
        if (t > s.nextBlink) {
          s.blinkUntil = t + 140;
          s.nextBlink = t + 2500 + Math.random() * 3500;
        }
        frame = t < s.blinkUntil ? "blink" : "sit";
      } else frame = s.mode;
      draw(frame);

      if (root.current) {
        root.current.style.transform = `translate(${s.x.toFixed(1)}px, ${(-s.y).toFixed(1)}px)`;
        root.current.classList.toggle("flip", s.dir < 0);
        root.current.dataset.climb = s.climb?.side ?? "";
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
    const onFeedAt = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      dropFood(x, y);
    };
    window.addEventListener("ink", onEvent);
    window.addEventListener("ink-feed", onFeedAt);
    const decayTimer = window.setInterval(() => saveNeeds(N.decay(needsRef.current, Date.now())), 60_000);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("ink", onEvent);
      window.removeEventListener("ink-feed", onFeedAt);
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
  const openMenu = () => {
    setMenuLift(st.current.y);
    setMenuLeft(Math.max(8, Math.min(window.innerWidth - 248, st.current.x - 88)));
  };

  /** Lifts her off the taskbar: whatever she was doing stops, and she hangs from the pointer. */
  const pickUp = (e: PointerEvent<HTMLButtonElement>, p: Press) => {
    const s = st.current;
    const box = e.currentTarget.getBoundingClientRect();
    window.clearTimeout(p.timer);
    p.carry = { dx: e.clientX - s.x, dy: box.bottom - e.clientY, ground: box.bottom + s.y };
    s.task = null;
    s.on = null;
    s.goal = null;
    s.route = [];
    s.climb = null;
    yarnRef.current = null;
    setYarnX(null);
    setMenuLeft(null);
    setMode("held");
    Sound.mrrp();
    say(awakeRef.current ? "mrrow?!" : "…mrr?", 1400);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const press: Press = {
      sx: e.clientX,
      sy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      dist: 0,
      strokes: 0,
      stroking: false,
      held: false,
      timer: 0,
      carry: null,
    };
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
    if (!p || p.held) return;
    if (p.carry) {
      const s = st.current;
      s.x = Math.max(0, Math.min(window.innerWidth - CAT_W, e.clientX - p.carry.dx));
      s.y = Math.max(0, p.carry.ground - (e.clientY + p.carry.dy));
      s.dir = e.clientX >= p.lx ? 1 : -1;
      p.lx = e.clientX;
      p.ly = e.clientY;
      return;
    }
    p.dist += Math.hypot(e.clientX - p.lx, e.clientY - p.ly);
    p.lx = e.clientX;
    p.ly = e.clientY;
    // The first real movement decides: up lifts her, sideways strokes her.
    if (p.dist > 14 && !p.stroking) {
      if (p.sy - e.clientY > Math.abs(e.clientX - p.sx)) return pickUp(e, p);
      p.stroking = true;
      window.clearTimeout(p.timer);
    }
    if (p.stroking && p.dist > (p.strokes + 1) * 60) {
      p.strokes++;
      stroke(p.strokes);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = st.current.press;
    st.current.press = null;
    if (!p || e.button === 2) return;
    window.clearTimeout(p.timer);
    if (p.carry) {
      // Let go: she drops to the taskbar where she was let go.
      st.current.vy = 0;
      setMode("fall");
      return;
    }
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
          aria-label={`Ink the cat, ${moodText}. Click to pet, drag sideways to stroke, drag up to pick her up, right-click or Shift+F10 for more.`}
          aria-haspopup="menu"
          aria-expanded={menuLeft !== null}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            const carried = st.current.press?.carry;
            st.current.press = null;
            if (carried) setMode("fall");
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

      {food && foodRef.current && (
        <div
          ref={foodEl}
          className="ink-prop ink-food"
          style={{ transform: `translate(${foodRef.current.x}px, ${-foodRef.current.y}px)` }}
        >
          <Sprite rows={FISH} className="ink-food-fish" />
          <Sprite rows={BOWL} />
        </div>
      )}
      {yarnX !== null && (
        <div className="ink-prop ink-yarn" style={{ transform: `translateX(${yarnX}px)` }} key={yarnX}>
          <Sprite rows={YARN} />
        </div>
      )}

      {menuLeft !== null && (
        <div
          className="ink-menu"
          style={{ left: menuLeft, bottom: `calc(var(--task-h) + 52px + ${Math.round(menuLift)}px)` }}
          role="menu"
          aria-label="Ink"
        >
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
                Call her over <small>or drag her up and drop her</small>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={sound}
                onClick={() => {
                  Sound.setSoundOn(!sound);
                  setSound(!sound);
                  if (!sound) Sound.mrrp();
                }}
              >
                Sounds <small>{sound ? "on" : "off"}</small>
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
