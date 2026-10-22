// Ink's voice, made with the Web Audio API: no sound files to load or license. Every sound starts from something
// the reader did (a click, a drag, a fish), so browsers allow it, and all of them can be switched off.

import type { Breed } from "@4me/shared";

const KEY = "4me-ink-sound";
let ctx: AudioContext | null = null;
let lastPurr = 0;

/** How a kind of cat sounds: higher or lower, longer or shorter, louder or softer, and the speed of her purr. */
type Voice = {
  pitch: number;
  length: number;
  rise: number;
  volume: number;
  wobble: number;
  purrRate: number;
  purrTone: number;
};
const VOICES: Record<Breed, Voice> = {
  shorthair: { pitch: 1, length: 1, rise: 1, volume: 1, wobble: 7, purrRate: 25, purrTone: 180 },
  // bright and chirpy
  tabby: { pitch: 1.12, length: 0.85, rise: 0.95, volume: 1, wobble: 8, purrRate: 26, purrTone: 190 },
  // short and clear
  tuxedo: { pitch: 1.05, length: 0.75, rise: 1.05, volume: 1, wobble: 6, purrRate: 25, purrTone: 180 },
  // loud, long and raspy: the talkers
  siamese: { pitch: 0.88, length: 1.55, rise: 1.25, volume: 1.3, wobble: 10, purrRate: 27, purrTone: 200 },
  // a big cat with a small high trill, and a deep purr
  longhair: { pitch: 1.3, length: 0.7, rise: 0.85, volume: 0.8, wobble: 12, purrRate: 21, purrTone: 140 },
  // low, soft and unhurried
  round: { pitch: 0.78, length: 0.95, rise: 0.8, volume: 0.7, wobble: 5, purrRate: 23, purrTone: 160 },
};
let vox = VOICES.shorthair;

/** Her voice follows what kind of cat she is. */
export function setVoice(breed: Breed) {
  vox = VOICES[breed] ?? VOICES.shorthair;
}

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // remembered for this visit only
  }
}

function audio(): AudioContext | null {
  if (!soundOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** White noise, made once, for purrs and crunches. */
let noiseBuffer: AudioBuffer | null = null;
function noise(a: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === a.sampleRate) return noiseBuffer;
  const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = b;
  return b;
}

/**
 * A meow: a buzzy voice whose pitch rises and falls, shaped by a formant filter that opens ("mi") and closes ("ow").
 * `pitch` scales the whole thing (higher for a chirp), `length` is in seconds.
 */
function meowLike(pitch: number, length: number, rise = 1.6, volume = 0.16) {
  const a = audio();
  if (!a) return;
  pitch *= vox.pitch;
  length *= vox.length;
  rise = 1 + (rise - 1) * vox.rise;
  volume = Math.min(0.24, volume * vox.volume);
  const t = a.currentTime;
  const voice = a.createOscillator();
  voice.type = "sawtooth";
  const base = 420 * pitch * (0.92 + Math.random() * 0.16);
  voice.frequency.setValueAtTime(base, t);
  voice.frequency.linearRampToValueAtTime(base * rise, t + length * 0.35);
  voice.frequency.exponentialRampToValueAtTime(base * 0.8, t + length);

  // a little wobble, so it doesn't sound like a synth
  const wobble = a.createOscillator();
  const wobbleDepth = a.createGain();
  wobble.frequency.value = vox.wobble;
  wobbleDepth.gain.value = base * 0.03;
  wobble.connect(wobbleDepth).connect(voice.frequency);

  const mouth = a.createBiquadFilter();
  mouth.type = "bandpass";
  mouth.Q.value = 4;
  mouth.frequency.setValueAtTime(900 * pitch, t);
  mouth.frequency.linearRampToValueAtTime(2200 * pitch, t + length * 0.3);
  mouth.frequency.linearRampToValueAtTime(700 * pitch, t + length);

  const level = a.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.exponentialRampToValueAtTime(volume, t + 0.04);
  level.gain.setValueAtTime(volume, t + length * 0.6);
  level.gain.exponentialRampToValueAtTime(0.0001, t + length);

  voice.connect(mouth).connect(level).connect(a.destination);
  voice.start(t);
  wobble.start(t);
  voice.stop(t + length + 0.05);
  wobble.stop(t + length + 0.05);
}

export const meow = () => meowLike(1, 0.55);
/** The short, rising "mrrp?" of a cat saying hello or asking a question. */
export const mrrp = () => meowLike(1.25, 0.22, 1.35, 0.12);
/** Sleepy, low and short. */
export const mew = () => meowLike(0.85, 0.3, 1.2, 0.08);
/** Startled by a BUZZ. */
export const yowl = () => meowLike(1.4, 0.35, 1.9, 0.14);

/** A purr: low rumble pulsing about 25 times a second. */
export function purr(seconds = 1.6) {
  const a = audio();
  const now = performance.now();
  if (!a || now - lastPurr < seconds * 800) return;
  lastPurr = now;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise(a);
  src.loop = true;
  const low = a.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = vox.purrTone;
  const pulse = a.createGain();
  pulse.gain.value = 0;
  const lfo = a.createOscillator();
  lfo.frequency.value = vox.purrRate;
  const lfoDepth = a.createGain();
  lfoDepth.gain.value = 0.5;
  const bias = a.createConstantSource();
  bias.offset.value = 0.5;
  lfo.connect(lfoDepth).connect(pulse.gain);
  bias.connect(pulse.gain);
  const level = a.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.exponentialRampToValueAtTime(0.5, t + 0.2);
  level.gain.setValueAtTime(0.5, t + seconds - 0.3);
  level.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(low).connect(pulse).connect(level).connect(a.destination);
  for (const n of [src, lfo, bias]) {
    n.start(t);
    n.stop(t + seconds + 0.05);
  }
}

/** Crunching kibble: a few short, bright bursts of noise. */
export function crunch(bites = 4) {
  const a = audio();
  if (!a) return;
  for (let i = 0; i < bites; i++) {
    const t = a.currentTime + i * (0.16 + Math.random() * 0.08);
    const src = a.createBufferSource();
    src.buffer = noise(a);
    const bright = a.createBiquadFilter();
    bright.type = "bandpass";
    bright.frequency.value = 1800 + Math.random() * 1500;
    bright.Q.value = 1.2;
    const level = a.createGain();
    level.gain.setValueAtTime(0.25, t);
    level.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bright).connect(level).connect(a.destination);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }
}

/** Landing on the taskbar after being dropped. */
export function thud() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  const level = a.createGain();
  level.gain.setValueAtTime(0.35, t);
  level.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(level).connect(a.destination);
  o.start(t);
  o.stop(t + 0.22);
}

/** The notification "ding": two soft bell tones, like a balloon popping up in the tray. */
export function chime() {
  const a = audio();
  if (!a) return;
  for (const [i, f] of [880, 1320].entries()) {
    const t = a.currentTime + i * 0.12;
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const level = a.createGain();
    level.gain.setValueAtTime(0.0001, t);
    level.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    level.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(level).connect(a.destination);
    o.start(t);
    o.stop(t + 0.65);
  }
}
