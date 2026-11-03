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

export type VoiceState = {
  on: boolean;
  /** No microphone (refused or none): listening only. */
  listenOnly: boolean;
  muted: boolean;
  /** Hold-to-talk instead of an open microphone. */
  ptt: boolean;
  talking: boolean;
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
  private silenced = new Set<number>();
  private timer = 0;
  private loudAt = new Map<number, number>();
  state: VoiceState = {
    on: false,
    listenOnly: false,
    muted: false,
    ptt: false,
    talking: false,
    speaking: new Set(),
    linked: new Set(),
    error: null,
  };

  constructor(
    private me: number,
    private send: (to: number, data: Signal) => void,
    private ice: IceServer[],
    private changed: (s: VoiceState) => void,
  ) {}

  private emit() {
    this.state = { ...this.state, speaking: new Set(this.state.speaking), linked: new Set(this.state.linked) };
    this.changed(this.state);
  }

  /** Joins the voice: asks for the microphone (once), then says hello to everyone at the table. */
  async join() {
    if (this.state.on) return;
    this.ctx = new AudioContext();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.micAnalyser = this.analyse(this.mic);
      this.state.listenOnly = false;
    } catch {
      this.mic = null;
      this.state.listenOnly = true;
    }
    this.state.on = true;
    this.state.error = null;
    this.applyMic();
    for (const id of this.seated) this.send(id, { kind: "hello" });
    this.timer = window.setInterval(() => this.listen(), 120);
    this.emit();
  }

  leave() {
    if (!this.state.on) return;
    for (const id of this.peers.keys()) this.send(id, { kind: "bye" });
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    void this.ctx?.close();
    this.ctx = null;
    window.clearInterval(this.timer);
    this.state = { ...this.state, on: false, talking: false, speaking: new Set(), linked: new Set() };
    this.emit();
  }

  /** Who is at the table (connected), and who this player may speak to and hear now. */
  setTable(seated: number[], speakTo: number[], hear: number[]) {
    this.seated = new Set(seated.filter((id) => id !== this.me));
    this.speakTo = new Set(speakTo);
    this.hear = new Set(hear);
    // Someone left the table: their line goes too.
    for (const id of [...this.peers.keys()]) if (!this.seated.has(id)) this.drop(id);
    this.route();
  }

  setMuted(muted: boolean) {
    this.state.muted = muted;
    this.applyMic();
    this.emit();
  }
  setPtt(ptt: boolean) {
    this.state.ptt = ptt;
    this.state.talking = false;
    this.applyMic();
    this.emit();
  }
  /** Hold-to-talk: pressed or released. */
  talk(on: boolean) {
    if (this.state.talking === on) return;
    this.state.talking = on;
    this.applyMic();
    this.emit();
  }
  /** This browser stops hearing one player (or hears them again). */
  silence(id: number, off: boolean) {
    if (off) this.silenced.add(id);
    else this.silenced.delete(id);
    this.route();
  }
  isSilenced(id: number) {
    return this.silenced.has(id);
  }

  private micOpen() {
    return Boolean(this.mic) && !this.state.muted && (!this.state.ptt || this.state.talking);
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
      p.audio.muted = !this.hear.has(id) || this.silenced.has(id);
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
