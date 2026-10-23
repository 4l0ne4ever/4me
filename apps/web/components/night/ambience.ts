// Night sounds, made in the browser with the Web Audio API: no recordings to load or license. Rain on a tin roof,
// a ceiling fan, crickets, and motorbikes passing a few streets away. They start only after the reader has touched
// the page (browsers allow nothing else), step back while music plays, and rest while the tab is hidden.

export type Ambient = "rain" | "fan" | "crickets" | "bikes";
export const AMBIENTS: Array<{ id: Ambient; label: string }> = [
  { id: "rain", label: "Rain on the tin roof" },
  { id: "fan", label: "Ceiling fan" },
  { id: "crickets", label: "Crickets" },
  { id: "bikes", label: "Motorbikes, a few streets away" },
];

type Voice = { gain: GainNode; stop: () => void };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const voices = new Map<Ambient, Voice>();
let volume = 0.6;
let ducked = false;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Sounds are only scheduled while the context runs; a resting tab would otherwise wake up to a pile of them. */
const running = (a: AudioContext) => a.state === "running";

function noiseBuffer(a: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === a.sampleRate) return noise;
  // Brown-ish noise: softer than white, closer to rain and air.
  const b = a.createBuffer(2, a.sampleRate * 4, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      d[i] = last * 3.2 + white * 0.08;
    }
  }
  noise = b;
  return b;
}

/** Where the master level should be: the reader's volume, lower while music plays. */
function level() {
  const a = ctx;
  if (!a || !master) return;
  const target = voices.size ? volume * (ducked ? 0.3 : 1) : 0;
  master.gain.cancelScheduledValues(a.currentTime);
  master.gain.setTargetAtTime(target, a.currentTime, 0.6);
}

function loopNoise(a: AudioContext, out: AudioNode) {
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  src.loopStart = Math.random();
  src.connect(out);
  src.start(0, Math.random() * 3);
  return src;
}

/** Steady rain, and drops on the tin now and then. */
function rain(a: AudioContext, out: GainNode): () => void {
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 500;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200;
  const g = a.createGain();
  g.gain.value = 0.5;
  const src = loopNoise(a, hp);
  hp.connect(lp).connect(g).connect(out);
  // Ticks on the roof: short, bright bursts at uneven intervals.
  let alive = true;
  const tick = () => {
    if (!alive) return;
    if (!running(a)) {
      timer = window.setTimeout(tick, 500);
      return;
    }
    const t = a.currentTime;
    const s = a.createBufferSource();
    s.buffer = noiseBuffer(a);
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400 + Math.random() * 3200;
    bp.Q.value = 8;
    const e = a.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.35, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    const pan = a.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    s.connect(bp).connect(e).connect(pan).connect(out);
    s.start(t, Math.random() * 3);
    s.stop(t + 0.08);
    timer = window.setTimeout(tick, 30 + Math.random() * 140);
  };
  let timer = window.setTimeout(tick, 200);
  return () => {
    alive = false;
    window.clearTimeout(timer);
    src.stop();
  };
}

/** A ceiling fan: a low hum, and the blades sweeping the air about three times a second. */
function fan(a: AudioContext, out: GainNode): () => void {
  const hum = a.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 50;
  const humG = a.createGain();
  humG.gain.value = 0.08;
  hum.connect(humG).connect(out);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  const sweep = a.createGain();
  sweep.gain.value = 0.35;
  const lfo = a.createOscillator();
  lfo.frequency.value = 3.1;
  const depth = a.createGain();
  depth.gain.value = 0.18;
  lfo.connect(depth).connect(sweep.gain);
  const src = loopNoise(a, lp);
  lp.connect(sweep).connect(out);
  hum.start();
  lfo.start();
  return () => {
    hum.stop();
    lfo.stop();
    src.stop();
  };
}

/** Two crickets, each with its own pitch and its own idea of time. */
function crickets(a: AudioContext, out: GainNode): () => void {
  let alive = true;
  const timers: number[] = [];
  const cricket = (freq: number, pan: number, gap: number) => {
    const chirp = () => {
      if (!alive) return;
      if (!running(a)) {
        timers.push(window.setTimeout(chirp, 500));
        return;
      }
      const t = a.currentTime;
      const o = a.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * (0.99 + Math.random() * 0.02);
      const e = a.createGain();
      e.gain.value = 0;
      // three quick pulses
      for (let i = 0; i < 3; i++) {
        const at = t + i * 0.05;
        e.gain.setValueAtTime(0.0001, at);
        e.gain.exponentialRampToValueAtTime(0.09, at + 0.008);
        e.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
      }
      const p = a.createStereoPanner();
      p.pan.value = pan;
      o.connect(e).connect(p).connect(out);
      o.start(t);
      o.stop(t + 0.2);
      timers.push(window.setTimeout(chirp, gap * (0.8 + Math.random() * 0.5)));
    };
    timers.push(window.setTimeout(chirp, Math.random() * gap));
  };
  cricket(4300, -0.6, 900);
  cricket(4750, 0.5, 1300);
  return () => {
    alive = false;
    for (const t of timers) window.clearTimeout(t);
  };
}

/** Now and then a motorbike goes past a few streets away: it rises, its note falls as it passes, and it fades. */
function bikes(a: AudioContext, out: GainNode): () => void {
  let alive = true;
  let timer = 0;
  const pass = () => {
    if (!alive) return;
    if (!running(a)) {
      timer = window.setTimeout(pass, 2000);
      return;
    }
    const t = a.currentTime;
    const len = 4 + Math.random() * 3;
    const o = a.createOscillator();
    o.type = "sawtooth";
    const base = 70 + Math.random() * 40;
    o.frequency.setValueAtTime(base * 1.12, t);
    o.frequency.linearRampToValueAtTime(base * 1.12, t + len * 0.45);
    o.frequency.linearRampToValueAtTime(base * 0.86, t + len * 0.6);
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const e = a.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.12, t + len * 0.5);
    e.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const p = a.createStereoPanner();
    const from = Math.random() < 0.5 ? -0.9 : 0.9;
    p.pan.setValueAtTime(from, t);
    p.pan.linearRampToValueAtTime(-from, t + len);
    o.connect(lp).connect(e).connect(p).connect(out);
    o.start(t);
    o.stop(t + len + 0.1);
    timer = window.setTimeout(pass, 12_000 + Math.random() * 30_000);
  };
  timer = window.setTimeout(pass, 2500 + Math.random() * 6000);
  return () => {
    alive = false;
    window.clearTimeout(timer);
  };
}

const MAKERS: Record<Ambient, (a: AudioContext, out: GainNode) => () => void> = { rain, fan, crickets, bikes };

/** Turns one sound on or off. Must first be called from something the reader did. */
export function setAmbient(id: Ambient, on: boolean) {
  if (!on) {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    const a = ctx;
    if (a) {
      v.gain.gain.setTargetAtTime(0, a.currentTime, 0.4);
      window.setTimeout(v.stop, 1600);
    } else v.stop();
    level();
    return;
  }
  if (voices.has(id)) return;
  const a = audio();
  if (!a || !master) return;
  const gain = a.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  gain.gain.setTargetAtTime(1, a.currentTime, 0.8);
  const stopSound = MAKERS[id](a, gain);
  voices.set(id, {
    gain,
    stop: () => {
      stopSound();
      gain.disconnect();
    },
  });
  level();
}

export function setAmbientVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  level();
}

/** Music started or stopped somewhere on the desktop. */
export function duckAmbient(on: boolean) {
  ducked = on;
  level();
}

/** A hidden tab rests: nothing plays, nothing is scheduled. */
export function pauseAmbient(paused: boolean) {
  if (!ctx) return;
  void (paused ? ctx.suspend() : ctx.resume());
}

export const ambientsOn = () => [...voices.keys()];
