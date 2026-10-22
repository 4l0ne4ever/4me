"use client";

import type { CatStats, InkLook, Me, Outfit } from "@4me/shared";
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
import { saveInk, saveInkLook } from "@/lib/member-actions";
import { IconHeart } from "../Icons";
import { DEFAULT_LOOK, framesFor, HAT_PALETTE, HAT_ROOM, hatFor, loadLook, outfitToday, paletteFor } from "./looks";
import * as N from "./needs";
import * as Sound from "./sounds";
import { BOWL, FISH, type FrameName, H, paint, W, YARN } from "./sprites";
import { Wardrobe } from "./Wardrobe";
import { CLIMB_INSET, findPlat, GROUND, landing, type Plat, plan, readPlatforms, type Step } from "./world";
import "./ink.css";

const SCALE = 3;
const CAT_W = W * SCALE;
/** In the eating frame the bowl starts 15 pixels into the sprite. */
const BOWL_OFFSET = 15 * SCALE;
const YARN_W = (YARN[0]?.length ?? 6) * SCALE;

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
type Task =
  | { kind: "feed" }
  /** `self` when she went to play on her own, not because someone asked. */
  | { kind: "play"; kicks: number; self?: boolean }
  | { kind: "call" }
  | { kind: "beg" }
  | null;
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
/** The ball of wool: where it lies (or rolls, or falls), and whether someone is carrying it. */
type Yarn = { x: number; y: number; vx: number; vy: number; on: string | null; platLeft: number; held: boolean };
/** Where she is going, and how. */
type Goal = { on: string; x: number; mode: Mode };

/** Pixels per second squared when she drops. */
const GRAVITY = 2600;

export type InkEvent = "buzz" | "note" | "call" | "feed" | "play" | "dress";

/** Let the rest of the desktop poke Ink: a buzz startles her, a note earns her a snack. */
export function nudgeInk(event: InkEvent) {
  window.dispatchEvent(new CustomEvent<InkEvent>("ink", { detail: event }));
}

let nameNow = "Ink";
/** What her reader named her (the "ink-name" event says when it changes). */
export const inkName = () => nameNow;

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

/** Her needs, kept per person on this browser: a guest's, and each member's under their own key. */
const STORE = "4me-ink";
const storeFor = (me: Me | null) => (me ? `${STORE}:u${me.id}` : STORE);
/** Where looks used to be kept for everyone on the browser; now they live in each member's account only. */
const OLD_LOOK_STORE = "4me-ink-look";
/** The ball of wool belongs to the desktop, not to a person. */
const YARN_STORE = "4me-ink-yarn";
const taskTop = () => document.querySelector(".task")?.getBoundingClientRect().top ?? window.innerHeight - 48;

type InkProps = { awake: boolean; stats: CatStats; onStats: (s: CatStats) => void; me: Me | null };

export function Ink({ awake, stats, onStats, me }: InkProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hatCanvas = useRef<HTMLCanvasElement>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [menuLeft, setMenuLeft] = useState<number | null>(null);
  const [menuLift, setMenuLift] = useState(0);
  const [food, setFood] = useState(false);
  const foodRef = useRef<Food | null>(null);
  const foodEl = useRef<HTMLDivElement>(null);
  const goRef = useRef<(on: string, x: number, speed?: number, mode?: Mode) => void>(() => undefined);
  const [yarnOut, setYarnOut] = useState(false);
  const yarnEl = useRef<HTMLButtonElement>(null);
  const [look, setLook] = useState<InkLook>(DEFAULT_LOOK);
  const [wardrobe, setWardrobe] = useState(false);
  const paletteRef = useRef(paletteFor(DEFAULT_LOOK));
  const framesRef = useRef(framesFor(DEFAULT_LOOK.breed));
  const hatRef = useRef<Outfit | null>(null);
  const [needs, setNeeds] = useState<N.Needs>(() => N.fresh(0));
  const [sound, setSound] = useState(true);

  const needsRef = useRef(needs);
  const firstItem = useRef<HTMLButtonElement>(null);
  const awakeRef = useRef(awake);
  const yarnRef = useRef<Yarn | null>(null);
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
    /** Sideways speed while leaping off a surface, and the surface she leapt from (she can't land back on it). */
    vx: 0,
    leaving: null as string | null,
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
  const store = useRef(STORE);
  const saveNeeds = useCallback((next: N.Needs) => {
    needsRef.current = next;
    setNeeds(next);
    try {
      localStorage.setItem(store.current, JSON.stringify(next));
    } catch {
      // storage can be off (private windows); Ink just forgets between visits
    }
    // Members keep Ink in their account too, so she is the same cat on every device. Saves are batched.
    if (signedIn.current) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void saveInk(needsRef.current), 4000);
    }
  }, []);

  // Whose Ink this is: a guest's, or a member's (kept in their account, so she is the same cat on every device).
  // Someone else signing in on the same browser never gets the last person's cat.
  useEffect(() => {
    window.clearTimeout(syncTimer.current);
    signedIn.current = Boolean(me);
    store.current = storeFor(me);
    const now = Date.now();
    const local = N.load(safeGet(store.current), now);
    // This browser's copy of their cat, or their account's, whichever was cared for most recently.
    saveNeeds(me?.ink && me.ink.at > local.at ? N.decay(me.ink, now) : local);
  }, [me, saveNeeds]);

  /** Dresses her: the palette and the hat are read by the drawing loop, which repaints on the next frame. */
  const wear = useCallback((next: InkLook) => {
    paletteRef.current = paletteFor(next);
    framesRef.current = framesFor(next.breed);
    Sound.setVoice(next.breed);
    hatRef.current = outfitToday(next, new Date());
    st.current.frame = "";
    setLook(next);
    // The Start menu names her too.
    nameNow = next.name;
    window.dispatchEvent(new CustomEvent<string>("ink-name", { detail: next.name }));
  }, []);

  /** Only a member can dress her, and the look is kept in their account alone. */
  const saveLook = useCallback(
    (next: InkLook) => {
      if (!signedIn.current) return;
      wear(next);
      void saveInkLook(next);
    },
    [wear],
  );

  // Her look is the member's own; a guest sees Ink as she was drawn. Only a different person changes it: `me` is
  // also replaced when they edit their profile, and still carries the look from before they last dressed her.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on who is signed in, on purpose
  useEffect(() => {
    wear(me?.inkLook ? loadLook(me.inkLook) : DEFAULT_LOOK);
    try {
      localStorage.removeItem(OLD_LOOK_STORE);
    } catch {
      // nothing to tidy
    }
  }, [me?.id, wear]);

  /** Dressing her up needs an account: a guest is taken to log on, and comes back to the same page. */
  const dressUp = useCallback(() => {
    setMenuLeft(null);
    if (signedIn.current) return setWardrobe(true);
    window.location.assign(`/welcome?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, []);

  /** Keeps the ball of wool where it is, for the next visit; null puts it away. */
  const storeYarn = useCallback(() => {
    const y = yarnRef.current;
    try {
      if (y) localStorage.setItem(YARN_STORE, JSON.stringify({ x: Math.round(y.x), y: Math.round(y.y) }));
      else localStorage.removeItem(YARN_STORE);
    } catch {
      // the wool just isn't remembered
    }
  }, []);

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

  /** Puts the ball of wool on the desktop, dropped from `height` above the taskbar at `x`; it stays wherever it ends up. */
  const throwYarn = useCallback(
    (x: number, height: number) => {
      yarnRef.current = {
        x: Math.max(0, Math.min(window.innerWidth - YARN_W, x)),
        y: Math.max(0, height),
        vx: 0,
        vy: 0,
        on: null,
        platLeft: 0,
        held: false,
      };
      setYarnOut(true);
      storeYarn();
    },
    [storeYarn],
  );

  const playNow = useCallback(() => {
    setMenuLeft(null);
    const s = st.current;
    if (!awakeRef.current) return say("zzz… too sleepy to play.");
    // No wool out yet: it drops a little way off, and she watches it land.
    if (!yarnRef.current) throwYarn(s.x > window.innerWidth / 2 ? s.x - 260 : s.x + 260, 220);
    const y = yarnRef.current;
    s.task = { kind: "play", kicks: 0 };
    if (y) s.dir = y.x > s.x ? 1 : -1;
    setMode("crouch", 600);
  }, [say, setMode, throwYarn]);

  const putYarnAway = useCallback(() => {
    setMenuLeft(null);
    yarnRef.current = null;
    setYarnOut(false);
    storeYarn();
    if (st.current.task?.kind === "play") st.current.task = null;
  }, [storeYarn]);

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
    // The ball of wool is where it was left last time; it drops onto whatever is there now.
    try {
      const saved = JSON.parse(safeGet(YARN_STORE) ?? "null") as { x?: unknown; y?: unknown } | null;
      if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
        throwYarn(saved.x, saved.y + 4);
        // The windows are still opening: it waits in the air a moment, so it finds the one it was left on.
        const y = yarnRef.current;
        if (y) {
          y.held = true;
          window.setTimeout(() => {
            y.held = false;
          }, 700);
        }
      }
    } catch {
      // nothing saved, or nothing readable
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ctx = canvas.current?.getContext("2d");
    const hctx = hatCanvas.current?.getContext("2d");
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
      if (step.kind === "drop") {
        // A leap out past the edge and down, in an arc.
        const here = s.on ? findPlat(surfaces(), s.on, width()) : null;
        const out = here && s.x + CAT_W / 2 < (here.left + here.right) / 2 ? -1 : 1;
        s.leaving = s.on;
        s.on = null;
        s.dir = out;
        s.vx = out * 190;
        s.vy = -420;
        return setMode("fall");
      }
      s.on = null;
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

    /** The wool, once it lies still somewhere she can reach. */
    const restingYarn = () => {
      const y = yarnRef.current;
      return y?.on && !y.held && Math.abs(y.vx) < 8 ? y : null;
    };
    const goYarn = () => {
      const y = restingYarn();
      if (!y?.on) return setMode("crouch", 300);
      go(y.on, approach(y.x + YARN_W / 2), 140, "run");
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
      if (s.goal && s.mode === "crouch") {
        s.route = plan({ on: s.on ?? GROUND, x: s.x }, s.goal, surfaces(), width(), CAT_W);
        return nextStep();
      }
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
        if (!yarnRef.current) {
          s.task = null;
          return setMode("sit", 1500);
        }
        // Still rolling, or falling: she waits, crouched, for it to stop.
        const y = restingYarn();
        if (!y) return setMode("crouch", 300);
        const cx = s.x + CAT_W / 2;
        const yx = y.x + YARN_W / 2;
        if (y.on !== s.on || Math.abs(yx - cx) > CAT_W * 0.75) return goYarn();
        if (task.kicks >= 3) {
          s.task = null;
          saveNeeds(task.self ? N.play(needsRef.current, 5) : N.play(needsRef.current));
          pop("heart", task.self ? 1 : 3);
          say(task.self ? "mrrp." : "again! …no. nap.");
          if (!task.self) void report("play");
          return setMode("happy", 1600);
        }
        // A swipe of the paw: the wool rolls off, and may roll right off the edge of a window.
        s.dir = yx >= cx ? 1 : -1;
        y.vx = s.dir * (200 + Math.random() * 220);
        task.kicks++;
        if (task.kicks > 1) Sound.mrrp();
        return setMode("crouch", 700);
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
      // The wool is lying about: now and then she goes and bats it around by herself.
      if (r < 0.28 && mood === "content" && restingYarn()) {
        s.task = { kind: "play", kicks: 1, self: true };
        return goYarn();
      }
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
      s.vx = 0;
      s.leaving = null;
      s.on = p.id;
      s.platLeft = p.left;
      if (s.goal) {
        // Paws down, a beat to steady herself, then on her way (idleDone picks the trip up again).
        Sound.thud();
        return setMode("crouch", speed > 900 ? 320 : 180);
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
      paint(ctx, framesRef.current[f], 0, 0, paletteRef.current);
      if (hctx) {
        hctx.clearRect(0, 0, W, H + HAT_ROOM);
        const outfit = hatRef.current;
        if (outfit) {
          const hat = hatFor(outfit, f);
          paint(hctx, hat.rows, hat.x, hat.y, HAT_PALETTE);
        }
      }
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
        s.x = Math.max(0, Math.min(width() - CAT_W, s.x + s.vx * dt));
        const cx = s.x + CAT_W / 2;
        const below = s.leaving ? up.filter((p) => p.id !== s.leaving) : up;
        const hit = reduce.matches
          ? landing(below, cx, from, Number.NEGATIVE_INFINITY, width())
          : s.vy > 0
            ? landing(below, cx, from, s.y, width())
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

      // The wool falls, lands, rides along with its window, and rolls when she swipes it.
      const yn = yarnRef.current;
      if (yn && !yn.held) {
        const W_ = width();
        if (!yn.on) {
          const from = yn.y;
          yn.vy += GRAVITY * dt;
          yn.y -= yn.vy * dt;
          yn.x = Math.max(0, Math.min(W_ - YARN_W, yn.x + yn.vx * dt));
          const hit = landing(up, yn.x + YARN_W / 2, from, reduce.matches ? Number.NEGATIVE_INFINITY : yn.y, W_);
          if (hit) {
            yn.on = hit.id;
            yn.y = hit.y;
            yn.vy = 0;
            yn.platLeft = hit.left;
            if (Math.abs(yn.vx) < 8) storeYarn();
          }
        } else {
          const p = yn.on === GROUND ? null : findPlat(up, yn.on, W_);
          if (yn.on !== GROUND && !p) {
            yn.on = null;
          } else {
            if (p) {
              yn.x += p.left - yn.platLeft;
              yn.platLeft = p.left;
              yn.y = p.y;
            }
            if (yn.vx !== 0) {
              yn.x += yn.vx * dt;
              yn.vx *= Math.exp(-2.6 * dt);
              if (yn.x < 0 || yn.x > W_ - YARN_W) {
                yn.x = Math.max(0, Math.min(W_ - YARN_W, yn.x));
                yn.vx = -yn.vx * 0.5;
              }
              const c = yn.x + YARN_W / 2;
              if (p && (c < p.left || c > p.right)) {
                // Off the edge of the window: it drops, still rolling outwards.
                yn.on = null;
                yn.vy = 0;
              } else if (Math.abs(yn.vx) < 8) {
                yn.vx = 0;
                storeYarn();
              }
            }
          }
        }
        const el = yarnEl.current;
        if (el) {
          el.style.transform = `translate(${yn.x.toFixed(1)}px, ${(-yn.y).toFixed(1)}px)`;
          el.style.setProperty("--spin", `${((yn.x / (YARN_W / 2)) * 57.3).toFixed(0)}deg`);
        }
      }

      let frame: FrameName;
      if (s.mode === "held") frame = "happy";
      // Stretched out mid-leap, tucked when simply dropping.
      else if (s.mode === "fall") frame = s.vx !== 0 ? "walkB" : "crouch";
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
      else if (kind === "dress") dressUp();
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
    s.vx = 0;
    s.leaving = null;
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
  /* ---------- the ball of wool, by hand ---------- */
  const yarnGrip = useRef<{ dx: number; dy: number; lx: number; lt: number; vx: number } | null>(null);
  const grabYarn = (e: PointerEvent<HTMLButtonElement>) => {
    const y = yarnRef.current;
    if (!y) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.getBoundingClientRect();
    yarnGrip.current = { dx: e.clientX - box.left, dy: box.bottom - e.clientY, lx: e.clientX, lt: e.timeStamp, vx: 0 };
    y.held = true;
    y.on = null;
    y.vx = 0;
    y.vy = 0;
  };
  const moveYarn = (e: PointerEvent<HTMLButtonElement>) => {
    const g = yarnGrip.current;
    const y = yarnRef.current;
    if (!g || !y) return;
    y.x = Math.max(0, Math.min(window.innerWidth - YARN_W, e.clientX - g.dx));
    y.y = Math.max(0, taskTop() - (e.clientY + g.dy));
    const dt = Math.max(1, e.timeStamp - g.lt);
    g.vx = ((e.clientX - g.lx) / dt) * 1000;
    g.lx = e.clientX;
    g.lt = e.timeStamp;
    if (yarnEl.current) yarnEl.current.style.transform = `translate(${y.x.toFixed(1)}px, ${(-y.y).toFixed(1)}px)`;
  };
  const dropYarn = (e: PointerEvent<HTMLButtonElement>) => {
    const g = yarnGrip.current;
    const y = yarnRef.current;
    yarnGrip.current = null;
    if (!g || !y) return;
    // Let go: it drops onto whatever is below, carrying a little of the throw (none if the hand had stopped).
    y.held = false;
    const still = e.timeStamp - g.lt > 90;
    y.vx = still ? 0 : Math.max(-360, Math.min(360, g.vx * 0.25));
    storeYarn();
    const s = st.current;
    if (
      awakeRef.current &&
      !s.task &&
      s.mode !== "held" &&
      N.moodOf(needsRef.current) === "content" &&
      Math.random() < 0.6
    ) {
      s.task = { kind: "play", kicks: 1, self: true };
      setMode("crouch", 500);
    }
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
          aria-label={`${look.name} the cat, ${moodText}. Click to pet, drag sideways to stroke, drag up to pick her up, right-click or Shift+F10 for more.`}
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
          <span className="ink-art">
            <canvas ref={canvas} width={W} height={H} />
            <canvas ref={hatCanvas} className="ink-hat" width={W} height={H + HAT_ROOM} />
          </span>
        </button>
        <span className="ink-name" aria-hidden="true">
          {look.name}
        </span>
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
      {yarnOut && (
        <button
          type="button"
          ref={yarnEl}
          className="ink-prop ink-yarn"
          style={
            yarnRef.current ? { transform: `translate(${yarnRef.current.x}px, ${-yarnRef.current.y}px)` } : undefined
          }
          aria-label={`A ball of wool. Drag it anywhere and it stays there; press Enter and ${look.name} plays with it.`}
          onPointerDown={grabYarn}
          onPointerMove={moveYarn}
          onPointerUp={dropYarn}
          onPointerCancel={dropYarn}
          onClick={(e) => {
            if (e.detail === 0) playNow();
          }}
        >
          <Sprite rows={YARN} />
        </button>
      )}
      {wardrobe && <Wardrobe look={look} onSave={saveLook} onClose={() => setWardrobe(false)} />}

      {menuLeft !== null && (
        <div
          className="ink-menu"
          style={{ left: menuLeft, bottom: `calc(var(--task-h) + 52px + ${Math.round(menuLift)}px)` }}
          role="menu"
          aria-label="Ink"
        >
          <header>
            <b>{look.name}</b>
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
                Play with the wool <small>+happy</small>
              </button>
            </li>
            {yarnOut && (
              <li>
                <button type="button" role="menuitem" onClick={putYarnAway}>
                  Put the wool away <small>or drag it somewhere</small>
                </button>
              </li>
            )}
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
              <button type="button" role="menuitem" onClick={dressUp}>
                Dress her up… <small>{me ? "name, colours, hat" : "log on first"}</small>
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
