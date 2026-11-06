// The village's sounds: real recordings (all CC0, from Freesound; see public/sounds/werewolf/CREDITS.txt), played
// with the Web Audio API. A wolf howls when night falls and another when the wolves wake, a rooster at daybreak, a
// church bell for a death, a gavel for the vote and the verdict, a chime when the Seer looks, a clock in the last
// seconds of your turn, and at the end a fanfare or the pack. Under it all, a bed that follows the game: a little
// medieval music on the square while the table fills, the village by day, a dark drone and crickets at night, and
// a tense one for the vote. Each role has its own sound when the narrator wakes it (a harp for Cupid, a glimmer for
// the Seer, a sword drawn for the Bodyguard, a howl for the wolves, the cauldron for the Witch), and the night's powers
// sound in the morning to whoever used them (the shield, the potion, the poison); the Hunter's shot is heard by all.
// Three levels, as in a game: everything, effects, music; the music steps back while someone is talking.

import { PLAYING } from "@/lib/clip";

const KEY = "4me-wolf-sound";
const BASE = "/sounds/werewolf/";

export type SoundPrefs = { on: boolean; effects: number; music: number };
const DEFAULTS: SoundPrefs = { on: true, effects: 0.8, music: 0.35 };

function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "off") return { ...DEFAULTS, on: false };
    if (raw === "on" || !raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: SoundPrefs | null = null;
const current = () => {
  prefs ??= loadPrefs();
  return prefs;
};
const listeners = new Set<() => void>();
/** Tells the window's controls (the speaker, the settings) that a level changed. */
export function onSoundChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current()));
  } catch {
    // for this visit only
  }
  for (const f of listeners) f();
  announce();
}

/** The desktop's own night sounds step back while the game's music plays, as they do for a song. */
let announced = false;
function announce() {
  const on = Boolean(wanted) && current().on && current().music > 0;
  if (on === announced) return;
  announced = on;
  window.dispatchEvent(new CustomEvent(PLAYING, { detail: { who: "werewolf", on } }));
}

/* ---------- the mixer ---------- */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fx: GainNode | null = null;
let music: GainNode | null = null;
/** Steps the music back while someone talks. */
let duck: GainNode | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      fx = ctx.createGain();
      music = ctx.createGain();
      duck = ctx.createGain();
      fx.connect(master);
      music.connect(duck).connect(master);
      master.connect(ctx.destination);
      levels();
      // a hidden tab plays no music
      document.addEventListener("visibilitychange", levels);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx.state === "closed" ? null : ctx;
  } catch {
    return null;
  }
}

function levels() {
  if (!ctx || !master || !fx || !music) return;
  const p = current();
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(p.on ? 1 : 0, t, 0.05);
  fx.gain.setTargetAtTime(p.effects, t, 0.05);
  music.gain.setTargetAtTime(document.hidden ? 0 : p.music, t, 0.3);
}

export function wolfSoundOn(): boolean {
  return current().on;
}
export function soundPrefs(): SoundPrefs {
  return { ...current() };
}
export function setWolfSoundOn(on: boolean) {
  current().on = on;
  save();
  levels();
}
export function setEffectsVolume(v: number) {
  current().effects = Math.max(0, Math.min(1, v));
  save();
  levels();
}
export function setMusicVolume(v: number) {
  current().music = Math.max(0, Math.min(1, v));
  save();
  levels();
}

/** Browsers start sound only after a click: the window calls this on the first one, so later sounds can play. */
export function unlockSound() {
  if (audio()) for (const name of CUES) void buffer(name);
}

/** Someone is talking in the voice: the music steps back, then comes forward again. */
export function duckMusic(on: boolean) {
  if (!ctx || !duck) return;
  duck.gain.setTargetAtTime(on ? 0.35 : 1, ctx.currentTime, on ? 0.15 : 0.8);
}

/* ---------- the recordings ---------- */

const CUES = [
  "howl",
  "howl-far",
  "rooster",
  "toll",
  "knock",
  "gavel",
  "tick",
  "vision",
  "fanfare",
  "pack",
  "cupid",
  "seer",
  "guard",
  "witch",
  "shield",
  "heal",
  "poison",
  "shot",
] as const;
type Cue = (typeof CUES)[number];
type BedFile = "lobby" | "day" | "night-drone" | "crickets" | "vote";

const buffers = new Map<string, Promise<AudioBuffer | null>>();
function buffer(name: Cue | BedFile): Promise<AudioBuffer | null> {
  const a = audio();
  if (!a) return Promise.resolve(null);
  let b = buffers.get(name);
  if (!b) {
    b = fetch(`${BASE}${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => a.decodeAudioData(data))
      .catch(() => {
        buffers.delete(name); // try again next time
        return null;
      });
    buffers.set(name, b);
  }
  return b;
}

/** Plays one recording through the effects, a little louder or softer, after a moment if asked. */
function cue(name: Cue, volume = 1, delay = 0) {
  const a = audio();
  if (!a || !fx || !current().on) return;
  void buffer(name).then((buf) => {
    if (!buf || !fx) return;
    const src = a.createBufferSource();
    src.buffer = buf;
    const g = a.createGain();
    g.gain.value = volume;
    src.connect(g).connect(fx);
    src.start(a.currentTime + delay);
  });
}

/* ---------- the bed under the game ---------- */

export type Bed = "lobby" | "day" | "night" | "vote";
const LAYERS: Record<Bed, Array<{ file: BedFile; gain: number }>> = {
  lobby: [{ file: "lobby", gain: 0.8 }],
  day: [{ file: "day", gain: 0.7 }],
  night: [
    { file: "night-drone", gain: 1 },
    { file: "crickets", gain: 0.55 },
  ],
  vote: [{ file: "vote", gain: 0.9 }],
};
const FADE = 2.4;
let playing: { bed: Bed; nodes: Array<{ src: AudioBufferSourceNode; gain: GainNode }> } | null = null;
let wanted: Bed | null = null;

/** The bed the game is in now (null: silence). Crossfades from the last one. */
export function setBed(bed: Bed | null) {
  wanted = bed;
  announce();
  if (playing?.bed === bed) return;
  const a = bed ? audio() : ctx;
  if (!a) return;
  const old = playing;
  playing = null;
  if (old)
    for (const n of old.nodes) {
      n.gain.gain.setTargetAtTime(0, a.currentTime, FADE / 4);
      n.src.stop(a.currentTime + FADE * 1.5);
    }
  if (!bed || !music) return;
  const mine = { bed, nodes: [] as Array<{ src: AudioBufferSourceNode; gain: GainNode }> };
  playing = mine;
  for (const layer of LAYERS[bed])
    void buffer(layer.file).then((buf) => {
      // the game moved on while this loaded
      if (!buf || !music || playing !== mine || wanted !== bed) return;
      const src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // (an mp3 has a few milliseconds of silence at each end: the loop skips them)
      src.loopStart = 0.05;
      src.loopEnd = buf.duration - 0.05;
      const gain = a.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(layer.gain, a.currentTime, FADE / 4);
      src.connect(gain).connect(music);
      // start somewhere in the loop, so the same table doesn't always open on the same bar
      src.start(a.currentTime, 0.05 + Math.random() * (buf.duration - 0.1));
      mine.nodes.push({ src, gain });
    });
}

/* ---------- a soft ping, made here: your turn ---------- */

function ping() {
  const a = audio();
  if (!a || !fx || !current().on) return;
  const t = a.currentTime + 0.02;
  for (const [f, at, v] of [
    [880, 0, 0.12],
    [1175, 0.12, 0.1],
  ] as const) {
    const osc = a.createOscillator();
    osc.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(v, t + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.4);
    osc.connect(g).connect(fx);
    osc.start(t + at);
    osc.stop(t + at + 0.45);
  }
}

/** Each turn of the night, as the narrator wakes it. */
const WAKE: Record<"cupid" | "seer" | "guard" | "wolves" | "witch", [Cue, number]> = {
  cupid: ["cupid", 0.6],
  seer: ["seer", 0.75],
  guard: ["guard", 0.7],
  wolves: ["howl-far", 0.45],
  witch: ["witch", 0.6],
};

export const sounds = {
  /** Night falls: a wolf howls. */
  night() {
    cue("howl", 0.55);
  },
  /** A role wakes in the night (everyone hears it): after a moment, when night has only just fallen. */
  wake(step: keyof typeof WAKE, delay = 0) {
    const [name, volume] = WAKE[step];
    cue(name, volume, delay);
  },
  /** The Bodyguard's watch held, or the Elder fought them off. */
  shield() {
    cue("shield", 0.8);
  },
  /** The Witch's potion saves someone. */
  heal() {
    cue("heal", 0.7);
  },
  /** The Witch's poison. */
  poison() {
    cue("poison", 0.7);
  },
  /** The Hunter's last shot. */
  shot() {
    cue("shot", 0.8);
  },
  /** Daybreak: the rooster. */
  dawn() {
    cue("rooster", 0.55);
  },
  /** Someone died: the church bell. */
  death() {
    cue("toll", 0.7);
  },
  /** The vote: a knock of the gavel. */
  vote() {
    cue("knock", 0.9);
  },
  /** The verdict: the gavel, three times. */
  verdict() {
    cue("gavel", 1);
  },
  /** The Seer looks into a house. */
  vision() {
    cue("vision", 0.8);
  },
  /** Your turn to choose. */
  turn() {
    ping();
  },
  /** The last seconds of your turn. */
  tick() {
    cue("tick", 0.5);
  },
  /** The end: a fanfare when you won; the pack when the wolves won and you didn't; the bell otherwise. */
  end(won: boolean, wolvesWon: boolean) {
    if (won) cue("fanfare", 0.9);
    else if (wolvesWon) cue("pack", 0.7);
    else cue("toll", 0.8);
  },
};
