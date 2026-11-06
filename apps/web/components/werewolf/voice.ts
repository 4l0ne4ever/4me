// The table's voice: every two players who have joined it talk straight to each other (WebRTC, one connection per
// pair, audio only), so it is as quick as the network between them allows. The table only carries the handshakes,
// and tells each player whose ears their microphone may reach: at night a villager's microphone reaches nobody and
// only the wolves hear each other. That is enforced where the sound leaves: a player's browser simply sends no
// sound to someone it may not reach.

export type IceServer = { urls: string | string[]; username?: string; credential?: string };
type Signal =
  | { kind: "hello" }
  | { kind: "hi" }
  | { kind: "bye" }
  | { kind: "sdp"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
  /** Candidates that arrived before the description they belong to. */
  early: RTCIceCandidateInit[];
};

/** How the microphone opens: while a key (or the button) is held, or all the time. */
export type MicMode = "ptt" | "open";

/** What this browser remembers about the voice, from one table to the next. */
export type VoicePrefs = {
  /** In the voice at all (hearing the others). */
  on: boolean;
  mode: MicMode;
  /** The push-to-talk key, as KeyboardEvent.code. */
  key: string;
  /** Everyone's voices, 0 to 1. */
  volume: number;
  /** One player's voice, 0 to 1 (by member id). */
  people: Record<string, number>;
  /** Players this browser doesn't hear. */
  silenced: number[];
  /** The microphone to use (null: the system's). */
  device: string | null;
};

const PREFS = "4me-wolf-voice";
const DEFAULTS: VoicePrefs = {
  on: true,
  mode: "ptt",
  key: "KeyV",
  volume: 0.9,
  people: {},
  silenced: [],
  device: null,
};

function loadPrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? "null") as Partial<VoicePrefs> | null;
    return { ...DEFAULTS, ...(raw ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** A key's name, for showing: KeyV → V, Digit1 → 1, Backquote → `. */
export function keyName(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = {
    Backquote: "`",
    Space: "Space",
    CapsLock: "Caps Lock",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    Tab: "Tab",
  };
  return named[code] ?? code;
}

export type VoiceState = {
  on: boolean;
  /** The microphone is open to this browser (asked for and allowed). */
  hasMic: boolean;
  /** The browser refused the microphone (or there is none): listening only. */
  micBlocked: boolean;
  /** The microphone switched off (in either mode). */
  muted: boolean;
  mode: MicMode;
  key: string;
  /** Holding the push-to-talk key or button now. */
  talking: boolean;
  volume: number;
  people: Record<string, number>;
  silenced: Set<number>;
  device: string | null;
  speaking: Set<number>;
  /** Players heard in this browser right now (joined the voice and connected). */
  linked: Set<number>;
  error: string | null;
};

const LEVEL = 0.035;
/** A voice counts as speaking for a moment after its last loud instant, so the light doesn't flicker between words. */
const HOLD_MS = 450;

export class Voice {
  private peers = new Map<number, Peer>();
  private mic: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private speakTo = new Set<number>();
  private hear = new Set<number>();
  private seated = new Set<number>();
  /** Those this browser has said hello to since joining. */
  private greeted = new Set<number>();
  private timer = 0;
  private loudAt = new Map<number, number>();
  private asking: Promise<boolean> | null = null;
  state: VoiceState;

  constructor(
    private me: number,
    private send: (to: number, data: Signal) => void,
    private ice: IceServer[],
    private changed: (s: VoiceState) => void,
  ) {
    const p = loadPrefs();
    this.state = {
      on: false,
      hasMic: false,
      micBlocked: false,
      muted: false,
      mode: p.mode,
      key: p.key,
      talking: false,
      volume: p.volume,
      people: p.people,
      silenced: new Set(p.silenced),
      device: p.device,
      speaking: new Set(),
      linked: new Set(),
      error: null,
    };
  }

  /** Whether the voice was on last time (a table joins it by itself, as a game does). */
  static wanted(): boolean {
    return loadPrefs().on;
  }

  private emit() {
    this.state = {
      ...this.state,
      speaking: new Set(this.state.speaking),
      linked: new Set(this.state.linked),
      silenced: new Set(this.state.silenced),
    };
    this.changed(this.state);
  }

  private save(patch: Partial<VoicePrefs> = {}) {
    const s = this.state;
    const prefs: VoicePrefs = {
      on: s.on,
      mode: s.mode,
      key: s.key,
      volume: s.volume,
      people: s.people,
      silenced: [...s.silenced],
      device: s.device,
      ...patch,
    };
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs));
    } catch {
      // for this visit only
    }
  }

  /**
   * Joins the voice: hears everyone at once, and says hello to whoever is at the table. The microphone is asked for
   * only when it is needed (an open mic, or the first time the talk key is held), unless it was allowed before.
   */
  async join() {
    if (this.state.on) return;
    this.ctx = new AudioContext();
    this.state.on = true;
    this.state.error = null;
    this.greeted.clear();
    this.greet();
    this.timer = window.setInterval(() => this.listen(), 120);
    this.save();
    this.emit();
    const allowed = await navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((r) => r.state === "granted")
      .catch(() => false);
    if (allowed || this.state.mode === "open") await this.ensureMic();
  }

  /** Leaves the voice; `remember` keeps it off for the next table too (closing the table doesn't). */
  leave(remember = true) {
    if (!this.state.on) return;
    for (const id of this.peers.keys()) this.send(id, { kind: "bye" });
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stopMic();
    void this.ctx?.close();
    this.ctx = null;
    window.clearInterval(this.timer);
    this.state = { ...this.state, on: false, hasMic: false, talking: false, speaking: new Set(), linked: new Set() };
    if (remember) this.save();
    this.emit();
  }

  /** Browsers start sound only after a click: the table calls this on the first one. */
  wake() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    for (const p of this.peers.values()) if (p.audio.paused && p.stream) void p.audio.play().catch(() => undefined);
  }

  /** Asks for the microphone, once; false when the browser won't give it. */
  ensureMic(): Promise<boolean> {
    if (this.mic) return Promise.resolve(true);
    this.asking ??= this.openMic().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  private async openMic(): Promise<boolean> {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.state.device ? { exact: this.state.device } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (!this.state.on) {
        for (const t of mic.getTracks()) t.stop();
        return false;
      }
      this.mic = mic;
      this.micAnalyser = this.analyse(mic);
      this.state.hasMic = true;
      this.state.micBlocked = false;
      this.state.error = null;
      this.applyMic();
      this.route();
      this.emit();
      return true;
    } catch {
      this.state.micBlocked = true;
      this.state.error = "The browser didn't give us the microphone. You can still listen.";
      this.emit();
      return false;
    }
  }

  private stopMic() {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    this.micAnalyser = null;
    this.state.hasMic = false;
  }

  /** Says hello to everyone at the table this browser hasn't greeted yet (newcomers, or everyone on joining). */
  private greet() {
    if (!this.state.on) return;
    for (const id of this.seated)
      if (!this.greeted.has(id)) {
        this.greeted.add(id);
        this.send(id, { kind: "hello" });
      }
  }

  /** Who is at the table (connected), and who this player may speak to and hear now. */
  setTable(seated: number[], speakTo: number[], hear: number[]) {
    this.seated = new Set(seated.filter((id) => id !== this.me));
    this.speakTo = new Set(speakTo);
    this.hear = new Set(hear);
    // Someone left the table: their line goes too (and a hello, should they come back).
    for (const id of [...this.peers.keys()]) if (!this.seated.has(id)) this.drop(id);
    for (const id of [...this.greeted]) if (!this.seated.has(id)) this.greeted.delete(id);
    this.greet();
    this.route();
  }

  setMuted(muted: boolean) {
    this.state.muted = muted;
    this.applyMic();
    this.emit();
    if (!muted && this.state.mode === "open") void this.ensureMic();
  }
  setMode(mode: MicMode) {
    this.state.mode = mode;
    this.state.talking = false;
    this.applyMic();
    this.save();
    this.emit();
    if (mode === "open" && !this.state.muted) void this.ensureMic();
  }
  setKey(code: string) {
    this.state.key = code;
    this.save();
    this.emit();
  }
  /** Push to talk: the key or the button pressed, or let go. The first press asks for the microphone. */
  talk(on: boolean) {
    if (this.state.talking === on) return;
    this.state.talking = on;
    if (on && !this.mic) void this.ensureMic();
    this.applyMic();
    this.emit();
  }
  setVolume(v: number) {
    this.state.volume = Math.max(0, Math.min(1, v));
    this.route();
    this.save();
    this.emit();
  }
  setPersonVolume(id: number, v: number) {
    this.state.people = { ...this.state.people, [String(id)]: Math.max(0, Math.min(1, v)) };
    this.route();
    this.save();
    this.emit();
  }
  personVolume(id: number) {
    return this.state.people[String(id)] ?? 1;
  }
  /** This browser stops hearing one player (or hears them again). */
  silence(id: number, off: boolean) {
    if (off) this.state.silenced.add(id);
    else this.state.silenced.delete(id);
    this.route();
    this.save();
    this.emit();
  }
  isSilenced(id: number) {
    return this.state.silenced.has(id);
  }
  /** Another microphone: the open one is swapped for it, on every line at once. */
  async setDevice(device: string | null) {
    this.state.device = device;
    this.save();
    if (this.mic) {
      this.stopMic();
      await this.ensureMic();
    }
    this.emit();
  }
  /** The microphones this browser can use (their names show once one has been allowed). */
  static async microphones(): Promise<Array<{ id: string; label: string }>> {
    const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
    return (all ?? [])
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  private micOpen() {
    return Boolean(this.mic) && !this.state.muted && (this.state.mode === "open" || this.state.talking);
  }
  private applyMic() {
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = this.micOpen();
  }

  /** Sends this player's sound only to those it may reach; plays only those this player may hear. */
  private route() {
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const [id, p] of this.peers) {
      const sender = p.pc.getTransceivers()[0]?.sender;
      const out = this.speakTo.has(id) ? track : null;
      if (sender && sender.track !== out) void sender.replaceTrack(out).catch(() => undefined);
      p.audio.muted = !this.hear.has(id) || this.state.silenced.has(id);
      p.audio.volume = Math.max(0, Math.min(1, this.state.volume * this.personVolume(id)));
    }
  }

  async signal(from: number, data: Signal) {
    if (!this.state.on || !this.seated.has(from)) {
      // Not in the voice: answer nothing. (A hello will come when we join.)
      return;
    }
    switch (data.kind) {
      case "hello":
      case "hi":
        if (data.kind === "hello") this.send(from, { kind: "hi" });
        // The lower id calls; the other answers.
        if (this.me < from && !this.peers.has(from)) await this.call(from);
        return;
      case "bye":
        this.drop(from);
        return;
      case "sdp":
        return this.description(from, data.sdp);
      case "ice": {
        const p = this.peers.get(from);
        if (!p) return;
        if (!p.pc.remoteDescription) p.early.push(data.candidate);
        else await p.pc.addIceCandidate(data.candidate).catch(() => undefined);
      }
    }
  }

  private peer(id: number): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: "max-bundle" });
    const audio = new Audio();
    audio.autoplay = true;
    const p: Peer = { pc, audio, stream: null, analyser: null, early: [] };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(id, { kind: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      p.stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = p.stream;
      void audio.play().catch(() => undefined);
      p.analyser = this.analyse(p.stream);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") this.state.linked.add(id);
      else this.state.linked.delete(id);
      // A dropped line: the caller tries again with fresh routes.
      if (s === "failed" && this.me < id) void this.call(id, true);
      this.emit();
    };
    this.peers.set(id, p);
    return p;
  }

  private async call(id: number, restart = false) {
    const p = this.peer(id);
    if (p.pc.getTransceivers().length === 0) p.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.route();
    const offer = await p.pc.createOffer({ iceRestart: restart });
    await p.pc.setLocalDescription(offer);
    this.send(id, { kind: "sdp", sdp: p.pc.localDescription!.toJSON() });
  }

  private async description(from: number, sdp: RTCSessionDescriptionInit) {
    let p = this.peers.get(from);
    if (sdp.type === "offer") {
      // A new call from someone who reloaded: start their line again.
      if (p && p.pc.signalingState !== "stable") {
        this.drop(from);
        p = undefined;
      }
      p = p ?? this.peer(from);
      await p.pc.setRemoteDescription(sdp);
      const tr = p.pc.getTransceivers()[0];
      if (tr) tr.direction = "sendrecv";
      this.route();
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      this.send(from, { kind: "sdp", sdp: p.pc.localDescription!.toJSON() });
    } else if (p && p.pc.signalingState === "have-local-offer") {
      await p.pc.setRemoteDescription(sdp);
    } else return;
    for (const c of p.early.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
  }

  private drop(id: number) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
    this.state.linked.delete(id);
    this.state.speaking.delete(id);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx) return null;
    try {
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(a);
      return a;
    } catch {
      return null;
    }
  }

  /** Who is talking right now, by the loudness of their sound (computed here, nothing is sent for it). */
  private listen() {
    const buf = new Float32Array(512);
    const loud = (a: AnalyserNode | null) => {
      if (!a) return false;
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length) > LEVEL;
    };
    const t = performance.now();
    if (this.micOpen() && loud(this.micAnalyser)) this.loudAt.set(this.me, t);
    for (const [id, p] of this.peers) if (!p.audio.muted && loud(p.analyser)) this.loudAt.set(id, t);
    const now = new Set<number>();
    for (const [id, at] of this.loudAt) {
      const muted = id === this.me ? !this.micOpen() : (this.peers.get(id)?.audio.muted ?? true);
      if (t - at < HOLD_MS && !muted) now.add(id);
    }
    const before = this.state.speaking;
    if (now.size !== before.size || [...now].some((id) => !before.has(id))) {
      this.state.speaking = now;
      this.emit();
    }
  }
}
