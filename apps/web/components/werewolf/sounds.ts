// The village's sounds, made with the Web Audio API like Ink's (no files to load or license): a wolf's howl when
// night falls, birds and a bell at daybreak, a low bell for a death, knocks for the vote, a soft ping when it is your
// turn, ticks in the last seconds, and a few notes at the end. Quiet, short, and all of them can be switched off.

const KEY = "4me-wolf-sound";
let ctx: AudioContext | null = null;

export function wolfSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setWolfSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // for this visit only
  }
}

/** Browsers start sound only after a click: the window calls this on the first one, so later sounds can play. */
export function unlockSound() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no sound here
  }
}

function audio(): AudioContext | null {
  if (!wolfSoundOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx.state === "closed" ? null : ctx;
  } catch {
    return null;
  }
}

/** One note: a shape, a pitch that may glide, an envelope. */
function tone(
  a: AudioContext,
  at: number,
  o: {
    type?: OscillatorType;
    from: number;
    to?: number;
    length: number;
    volume: number;
    attack?: number;
    vibrato?: number;
    filter?: number;
  },
) {
  const osc = a.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.length * 0.9);
  if (o.vibrato) {
    const lfo = a.createOscillator();
    const depth = a.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + o.length + 0.1);
  }
  const level = a.createGain();
  const attack = o.attack ?? 0.01;
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(o.volume, at + attack);
  level.gain.exponentialRampToValueAtTime(0.0001, at + o.length);
  let out: AudioNode = osc;
  if (o.filter) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.filter;
    out = out.connect(f);
  }
  out.connect(level).connect(a.destination);
  osc.start(at);
  osc.stop(at + o.length + 0.05);
}

/** A short burst of filtered noise: a knock on wood, a gust. */
function knock(a: AudioContext, at: number, pitch = 220, volume = 0.3) {
  const b = a.createBuffer(1, Math.floor(a.sampleRate * 0.08), a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = b;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = pitch * 4;
  f.Q.value = 3;
  const level = a.createGain();
  level.gain.value = volume;
  src.connect(f).connect(level).connect(a.destination);
  src.start(at);
  tone(a, at, { type: "triangle", from: pitch, to: pitch * 0.7, length: 0.12, volume: volume * 0.5 });
}

export const sounds = {
  /** Night falls: a wolf howls, far off, rising and falling. */
  night() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.05;
    tone(a, t, {
      type: "sawtooth",
      from: 330,
      to: 560,
      length: 0.9,
      volume: 0.05,
      attack: 0.35,
      vibrato: 6,
      filter: 1100,
    });
    tone(a, t + 0.85, {
      type: "sawtooth",
      from: 560,
      to: 380,
      length: 1.6,
      volume: 0.045,
      attack: 0.05,
      vibrato: 9,
      filter: 900,
    });
  },
  /** Daybreak: a bell over the square, and a bird. */
  dawn() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.05;
    tone(a, t, { from: 660, length: 1.8, volume: 0.07 });
    tone(a, t, { from: 1320, length: 1.1, volume: 0.025 });
    for (let i = 0; i < 3; i++)
      tone(a, t + 0.7 + i * 0.16, { from: 2400 + i * 180, to: 3100 + i * 120, length: 0.09, volume: 0.03 });
  },
  /** Someone died: a low bell. */
  death() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.05;
    tone(a, t, { from: 98, length: 2.6, volume: 0.16 });
    tone(a, t, { from: 196, length: 1.8, volume: 0.06 });
    tone(a, t, { from: 293, length: 1.2, volume: 0.03 });
  },
  /** The vote: two knocks on the table. */
  vote() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.05;
    knock(a, t);
    knock(a, t + 0.22);
  },
  /** The verdict: one heavy knock. */
  verdict() {
    const a = audio();
    if (!a) return;
    knock(a, a.currentTime + 0.05, 150, 0.42);
  },
  /** Your turn to choose. */
  turn() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.02;
    tone(a, t, { from: 880, length: 0.35, volume: 0.05 });
    tone(a, t + 0.12, { from: 1175, length: 0.4, volume: 0.04 });
  },
  /** The last seconds of your turn. */
  tick() {
    const a = audio();
    if (!a) return;
    knock(a, a.currentTime + 0.01, 520, 0.08);
  },
  /** The end: up for a win, down for a loss. */
  end(won: boolean) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.05;
    const notes = won ? [523, 659, 784, 1047] : [440, 392, 330, 262];
    notes.forEach((f, i) => {
      tone(a, t + i * 0.18, { type: "triangle", from: f, length: 0.7, volume: 0.07 });
    });
  },
};
