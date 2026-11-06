import { z } from "zod";
import { avatarUrl } from "./accounts";

// Werewolf, played at a table on the desktop. The game is run here, as plain functions over one `Table` object: the
// API's table (a Durable Object per table in production, memory in development) keeps the object, feeds it what
// players do and the clock, and sends each player only what they may know (`viewFor`). The computer is the narrator.

/* ---------- roles ---------- */

export type RoleId =
  | "villager"
  | "werewolf"
  | "wolfcub"
  | "seer"
  | "bodyguard"
  | "witch"
  | "hunter"
  | "cupid"
  | "elder"
  | "idiot"
  | "cursed"
  | "tanner";

export type Team = "village" | "wolves" | "tanner";

export type RoleInfo = {
  name: string;
  team: Team;
  /** How many a table may have. Villagers fill whatever seats are left. */
  max: number;
  /** One line for the role card. */
  blurb: string;
};

export const ROLES: Record<RoleId, RoleInfo> = {
  villager: {
    name: "Villager",
    team: "village",
    max: 16,
    blurb: "No power but your vote. Listen, ask, and find the wolves.",
  },
  werewolf: {
    name: "Werewolf",
    team: "wolves",
    max: 5,
    blurb: "Each night the wolves agree on someone to eat. By day, pass for a villager.",
  },
  wolfcub: {
    name: "Wolf cub",
    team: "wolves",
    max: 1,
    blurb: "A wolf. If the village kills you, the wolves take two the next night.",
  },
  seer: {
    name: "Seer",
    team: "village",
    max: 1,
    blurb: "Each night, look into one player's house and learn who they really are.",
  },
  bodyguard: {
    name: "Bodyguard",
    team: "village",
    max: 1,
    blurb: "Each night, guard one player (yourself too) from the wolves; never the same one two nights running.",
  },
  witch: {
    name: "Witch",
    team: "village",
    max: 1,
    blurb: "You learn who the wolves attacked. One potion to save, one to poison, each once a game.",
  },
  hunter: {
    name: "Hunter",
    team: "village",
    max: 1,
    blurb: "When you die, however it happens, you take one player down with you.",
  },
  cupid: {
    name: "Cupid",
    team: "village",
    max: 1,
    blurb: "On the first night, make two players lovers. If one dies, the other dies of grief.",
  },
  elder: {
    name: "Elder",
    team: "village",
    max: 1,
    blurb: "Tough old soul: you survive the first time the wolves attack you.",
  },
  idiot: {
    name: "Village idiot",
    team: "village",
    max: 1,
    blurb: "If the village votes you out, they see who you are and you stay, but you lose your vote.",
  },
  cursed: {
    name: "Cursed",
    team: "village",
    max: 1,
    blurb: "A villager, until the wolves bite you: then you wake up one of them. Until then the Seer sees a Villager.",
  },
  tanner: {
    name: "Tanner",
    team: "tanner",
    max: 1,
    blurb: "Tired of it all. You win alone if the village votes you out.",
  },
};

/** The order roles are listed in, the settings and the role cards. */
export const ROLE_ORDER: RoleId[] = [
  "werewolf",
  "wolfcub",
  "seer",
  "bodyguard",
  "witch",
  "hunter",
  "cupid",
  "elder",
  "idiot",
  "cursed",
  "tanner",
  "villager",
];

export const isWolf = (r: RoleId | null | undefined) => r === "werewolf" || r === "wolfcub";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 16;

/* ---------- settings ---------- */

const special = ROLE_ORDER.filter((r) => r !== "villager") as Exclude<RoleId, "villager">[];
const roleCounts = z.object(
  Object.fromEntries(special.map((r) => [r, z.number().int().min(0).max(ROLES[r].max).default(0)])) as Record<
    Exclude<RoleId, "villager">,
    z.ZodDefault<z.ZodNumber>
  >,
);

export const tableSettings = z.object({
  /** How many may sit at the table. */
  seats: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(10),
  /** The special roles; villagers fill the rest. */
  roles: roleCounts,
  /** The roles follow how many are sitting down (suggestRoles), until the host picks their own. */
  auto: z.boolean().default(true),
  /** Seconds for each role's turn at night (the Seer's, the Bodyguard's, the wolves', the Witch's…). */
  night: z.number().int().min(10).max(120).default(25),
  discussion: z.number().int().min(30).max(600).default(150),
  vote: z.number().int().min(15).max(120).default(45),
  /** Elect a sheriff on the first day: their vote counts twice, and they pass the badge on when they die. */
  sheriff: z.boolean().default(true),
  /** Show a player's role when they die. */
  reveal: z.boolean().default(true),
  /** Listed on the desktop for anyone to join, or only for those with the link. */
  listed: z.boolean().default(true),
});
export type TableSettings = z.infer<typeof tableSettings>;
export type RoleCounts = TableSettings["roles"];

/** A sensible set of roles for this many players. */
export function suggestRoles(n: number): RoleCounts {
  const r = roleCounts.parse({});
  r.werewolf = n >= 11 ? 3 : n >= 7 ? 2 : 1;
  r.seer = 1;
  r.bodyguard = n >= 6 ? 1 : 0;
  r.witch = n >= 6 ? 1 : 0;
  r.hunter = n >= 7 ? 1 : 0;
  r.cupid = n >= 9 ? 1 : 0;
  r.idiot = n >= 11 ? 1 : 0;
  r.wolfcub = n >= 13 ? 1 : 0;
  r.elder = n >= 13 ? 1 : 0;
  r.cursed = n >= 14 ? 1 : 0;
  return r;
}

export const defaultSettings = (): TableSettings => {
  const s = tableSettings.parse({ roles: {} });
  s.roles = suggestRoles(s.seats);
  return s;
};

export const wolvesIn = (r: RoleCounts) => r.werewolf + r.wolfcub;
export const specialsIn = (r: RoleCounts) => special.reduce((n, k) => n + r[k], 0);

/** Why this table can't start with this many players yet, or null when it can. */
export function cannotStart(settings: TableSettings, players: number): string | null {
  if (players < MIN_PLAYERS) return `at least ${MIN_PLAYERS} players are needed`;
  const wolves = wolvesIn(settings.roles);
  if (wolves < 1) return "there must be at least one wolf";
  if (wolves * 2 >= players) return "too many wolves for this many players";
  if (specialsIn(settings.roles) > players) return "more roles than players";
  return null;
}

/* ---------- the table ---------- */

export type Phase =
  | "lobby"
  | "deal"
  | "night"
  | "witch"
  | "dawn"
  | "hunter"
  | "badge"
  | "election"
  | "discussion"
  | "vote"
  | "verdict"
  | "over";

/** Phases that are night: only the wolves talk. */
export const NIGHT_PHASES: Phase[] = ["deal", "night", "witch"];

/**
 * The night goes round the roles one at a time, in the narrator's order: Cupid (the first night only), the Seer, the
 * Bodyguard, the wolves; then the Witch, who learns what the wolves did (her own phase). Each has its own time.
 */
export type NightStep = "cupid" | "seer" | "guard" | "wolves";
export const NIGHT_STEPS: NightStep[] = ["cupid", "seer", "guard", "wolves"];

/** Who sits down: what the API knows about a member. */
export type Seat = { id: number; name: string; handle: string; avatar: string };

export type Player = Seat & {
  connected: boolean;
  alive: boolean;
  role: RoleId | null;
  /** A Cursed player the wolves turned: their role is "werewolf" now. */
  turned: boolean;
  /** Everyone knows this player's role (they died with reveal on, or are the unmasked idiot). */
  shown: boolean;
  canVote: boolean;
  /** Ready to vote before the discussion's time is up. */
  ready: boolean;
  /** A computer player the host sat down, so a few friends (or one person) can play a whole game. */
  bot?: boolean;
};

export type LogLine = { at: number; day: number; text: string; kind: "night" | "day" | "death" | "info" | "end" };
export type Channel = "all" | "wolves" | "dead";
export type ChatLine = { id: number; from: number; name: string; body: string; channel: Channel; at: number };
export type Winner = { team: Team | "lovers" | "nobody"; ids: number[] };

export type Table = {
  v: 1;
  code: string;
  host: number;
  createdAt: number;
  updatedAt: number;
  settings: TableSettings;
  players: Player[];
  phase: Phase;
  deadline: number | null;
  /** Night n is followed by day n. */
  day: number;
  /** The Hunter shooting, or the sheriff passing the badge. */
  actor: number | null;
  /** Where the game goes once the deaths of a dawn or a verdict are dealt with. */
  resume: "day" | "night";
  pending: Array<{ kind: "hunter" | "badge"; id: number }>;
  lovers: [number, number] | null;
  sheriff: number | null;
  elected: boolean;
  lastGuarded: number | null;
  potions: { heal: boolean; poison: boolean };
  elderLives: number;
  cubBonus: boolean;
  night: {
    kills: number;
    wolf: Record<string, number[]>;
    guard: number | null;
    seer: number | null;
    cupid: number[] | null;
    attacked: number[];
    heal: number | null;
    poison: number | null;
    witchDone: boolean;
    /** Whose turn it is tonight (missing on a table from before the night had turns: everyone's at once). */
    step?: NightStep | null;
  };
  /** What each Seer has seen: seer → player → the role they saw. */
  seen?: Record<string, Record<string, RoleId>>;
  /** Votes in a vote or an election: voter → target (0: nobody). */
  votes: Record<string, number>;
  notes: Record<string, Array<{ day: number; text: string }>>;
  log: LogLine[];
  chat: ChatLine[];
  seq: number;
  winner: Winner | null;
  /** A password the host set: only its salted hash is kept. Players already sitting stay. */
  lock?: { salt: string; hash: string } | null;
  /** Who gave the password, so their browser may sit down (and come back). */
  allowed?: number[];
  /** Who the host asked not to come back to this table. */
  banned?: number[];
};

/** Why a table turns someone away when it has a password: the browser asks for it on this. */
export const TABLE_LOCKED = "this table has a password";
/** What someone the host asked to leave is told, and someone asked not to come back. */
export const TABLE_KICKED = "the host asked you to leave this table";
export const TABLE_BANNED = "the host asked you not to come back to this table";

/* ---------- computer players ---------- */

/** Computer players' ids: far above any member's, so the two never meet. */
export const BOT_BASE = 2_000_000_000;
export const isBotId = (id: number) => id >= BOT_BASE;
/** The village's night creatures, who sit in when there aren't enough people. */
const BOT_NAMES = [
  "Owl",
  "Moth",
  "Fox",
  "Crow",
  "Hare",
  "Badger",
  "Toad",
  "Bat",
  "Heron",
  "Wren",
  "Stoat",
  "Newt",
  "Mole",
  "Lark",
  "Vole",
] as const;

export type Rand = () => number;

const SEC = 1000;
const DEAL_MS = 12 * SEC;
const DAWN_MS = 9 * SEC;
const VERDICT_MS = 8 * SEC;
const HUNTER_MS = 25 * SEC;
const BADGE_MS = 20 * SEC;
const ELECTION_MS = 45 * SEC;
const MAX_LOG = 120;
const MAX_CHAT = 120;

const freshNight = (kills = 1): Table["night"] => ({
  kills,
  wolf: {},
  guard: null,
  seer: null,
  cupid: null,
  attacked: [],
  heal: null,
  poison: null,
  witchDone: false,
  step: null,
});

export function newTable(code: string, host: Seat, now: number, settings = defaultSettings()): Table {
  return {
    v: 1,
    code,
    host: host.id,
    createdAt: now,
    updatedAt: now,
    settings,
    players: [seatFor(host)],
    phase: "lobby",
    deadline: null,
    day: 0,
    actor: null,
    resume: "day",
    pending: [],
    lovers: null,
    sheriff: null,
    elected: false,
    lastGuarded: null,
    potions: { heal: true, poison: true },
    elderLives: 1,
    cubBonus: false,
    night: freshNight(),
    votes: {},
    notes: {},
    log: [],
    chat: [],
    seq: 0,
    winner: null,
  };
}

const seatFor = (s: Seat): Player => ({
  ...s,
  connected: true,
  alive: true,
  role: null,
  turned: false,
  shown: false,
  canVote: true,
  ready: false,
});

const find = (t: Table, id: number) => t.players.find((p) => p.id === id);
const alive = (t: Table) => t.players.filter((p) => p.alive);
const roleName = (p: Player) => (p.role ? (p.turned ? "Cursed, turned werewolf" : ROLES[p.role].name) : "");
/** "Lan", or "Lan (Seer)" when the table shows roles on death. */
const named = (t: Table, p: Player) => (t.settings.reveal && p.role ? `${p.name} (${roleName(p)})` : p.name);

function log(t: Table, kind: LogLine["kind"], text: string, now: number) {
  t.log.push({ at: now, day: t.day, text, kind });
  if (t.log.length > MAX_LOG) t.log.splice(0, t.log.length - MAX_LOG);
}
function note(t: Table, id: number, text: string) {
  const key = String(id);
  t.notes[key] = t.notes[key] ?? [];
  t.notes[key].push({ day: t.day, text });
}

/* ---------- people coming and going ---------- */

export type Result = { ok: true } | { error: string };
const ok: Result = { ok: true };

/** A member opens the table: a seat in the lobby, or back in their seat in a game. */
export function arrive(t: Table, seat: Seat, now: number): Result {
  const p = find(t, seat.id);
  if (p) {
    Object.assign(p, { name: seat.name, avatar: seat.avatar, handle: seat.handle, connected: true });
    t.updatedAt = now;
    return ok;
  }
  if (t.banned?.includes(seat.id)) return { error: TABLE_BANNED };
  if (t.phase !== "lobby") return { error: "this game has already started" };
  if (t.lock && !t.allowed?.includes(seat.id)) return { error: TABLE_LOCKED };
  if (t.players.length >= t.settings.seats) return { error: "this table is full" };
  t.players.push(seatFor(seat));
  if (!find(t, t.host)) t.host = seat.id;
  autoRoles(t);
  t.updatedAt = now;
  return ok;
}

/** With automatic roles on, a set that suits however many are sitting down. */
function autoRoles(t: Table) {
  if (t.settings.auto && t.phase === "lobby") t.settings.roles = suggestRoles(Math.max(MIN_PLAYERS, t.players.length));
}

export function setConnected(t: Table, id: number, connected: boolean, now: number) {
  const p = find(t, id);
  if (!p || p.connected === connected) return;
  p.connected = connected;
  t.updatedAt = now;
}

/** Leaving the lobby frees the seat; leaving a game only goes away (the seat stays theirs). */
/** The next host when the host goes: someone at the table, never a computer player. */
function nextHost(t: Table): number {
  const people = t.players.filter((p) => !p.bot);
  return people.find((p) => p.connected)?.id ?? people[0]?.id ?? 0;
}

function leave(t: Table, id: number, now: number) {
  if (t.phase === "lobby" || t.phase === "over") {
    t.players = t.players.filter((p) => p.id !== id);
    if (t.host === id) t.host = nextHost(t);
    autoRoles(t);
  } else setConnected(t, id, false, now);
  t.updatedAt = now;
}

/* ---------- commands ---------- */

export const tableCommand = z.discriminatedUnion("t", [
  z.object({ t: z.literal("settings"), settings: tableSettings }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("kick"), id: z.number().int(), ban: z.boolean().optional() }),
  z.object({ t: z.literal("bot"), add: z.boolean() }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("again") }),
  z.object({ t: z.literal("ready"), ready: z.boolean() }),
  z.object({ t: z.literal("chat"), body: z.string().trim().min(1).max(300) }),
  z.object({ t: z.literal("pick"), ids: z.array(z.number().int().min(0)).max(2) }),
  z.object({
    t: z.literal("witch"),
    heal: z.number().int().positive().nullable(),
    poison: z.number().int().positive().nullable(),
  }),
]);
export type TableCommand = z.infer<typeof tableCommand>;

export function command(t: Table, by: number, cmd: TableCommand, now: number, rand: Rand): Result {
  const me = find(t, by);
  if (!me) return { error: "you're not at this table" };
  const host = t.host === by;
  switch (cmd.t) {
    case "settings": {
      if (!host) return { error: "only the host changes the table" };
      if (t.phase !== "lobby") return { error: "the game has started" };
      if (cmd.settings.seats < t.players.length) return { error: "more people are already sitting here" };
      t.settings = cmd.settings;
      autoRoles(t);
      break;
    }
    case "kick": {
      if (!host || (t.phase !== "lobby" && t.phase !== "over") || cmd.id === by || !find(t, cmd.id))
        return { error: "you can't do that" };
      t.players = t.players.filter((p) => p.id !== cmd.id);
      // Asked to leave: the password they gave no longer seats them; asked not to come back: nothing does.
      if (t.allowed) t.allowed = t.allowed.filter((id) => id !== cmd.id);
      if (cmd.ban && !isBotId(cmd.id)) t.banned = [...new Set([...(t.banned ?? []), cmd.id])].slice(-200);
      autoRoles(t);
      break;
    }
    case "bot": {
      if (!host || t.phase !== "lobby") return { error: "only the host, before the game" };
      if (cmd.add) {
        if (t.players.length >= t.settings.seats) return { error: "this table is full" };
        const taken = new Set(t.players.map((p) => p.id));
        const k = BOT_NAMES.findIndex((_, i) => !taken.has(BOT_BASE + i));
        if (k < 0) return { error: "no more creatures in the woods" };
        t.players.push({
          ...seatFor({ id: BOT_BASE + k, name: BOT_NAMES[k]!, handle: "", avatar: avatarUrl(null) }),
          bot: true,
        });
      } else {
        const last = t.players.findLast((p) => p.bot);
        if (!last) return { error: "no computer players here" };
        t.players = t.players.filter((p) => p !== last);
      }
      autoRoles(t);
      break;
    }
    case "leave":
      leave(t, by, now);
      return ok;
    case "start": {
      if (!host) return { error: "only the host starts the game" };
      if (t.phase !== "lobby") return { error: "the game has started" };
      // Whoever has gone away doesn't get dealt in.
      t.players = t.players.filter((p) => p.connected);
      autoRoles(t);
      const why = cannotStart(t.settings, t.players.length);
      if (why) return { error: why };
      deal(t, now, rand);
      break;
    }
    case "again": {
      if (!host || t.phase !== "over") return { error: "you can't do that" };
      backToLobby(t, now);
      break;
    }
    case "ready": {
      if (t.phase !== "discussion" || !me.alive) return { error: "not now" };
      me.ready = cmd.ready;
      const living = alive(t);
      if (living.filter((p) => p.ready).length >= Math.ceil((living.length * 2) / 3)) startVote(t, now);
      break;
    }
    case "chat": {
      const channel = chatChannel(t, me);
      if (!channel) return { error: "it's night: only the wolves can talk" };
      t.seq += 1;
      t.chat.push({ id: t.seq, from: by, name: me.name, body: cmd.body, channel, at: now });
      if (t.chat.length > MAX_CHAT) t.chat.splice(0, t.chat.length - MAX_CHAT);
      break;
    }
    case "pick": {
      const r = pick(t, me, cmd.ids, now, rand);
      if ("error" in r) return r;
      break;
    }
    case "witch": {
      const r = witch(t, me, cmd.heal, cmd.poison, now);
      if ("error" in r) return r;
      break;
    }
  }
  t.updatedAt = now;
  return ok;
}

/** Where this player's words go right now, or null when they must stay quiet. */
export function chatChannel(t: Table, p: Player): Channel | null {
  if (t.phase === "lobby" || t.phase === "over") return "all";
  if (!p.alive) return "dead";
  if (NIGHT_PHASES.includes(t.phase)) return isWolf(p.role) ? "wolves" : null;
  return "all";
}

/** Whether this player may read a line: the dead and a finished game see every channel. */
export function canRead(t: Table, p: Player | undefined, line: ChatLine): boolean {
  if (line.channel === "all" || t.phase === "over" || t.phase === "lobby") return true;
  if (!p) return false;
  if (!p.alive) return true;
  return line.channel === "wolves" && isWolf(p.role);
}

/* ---------- the game ---------- */

function shuffle<T>(xs: T[], rand: Rand): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function deal(t: Table, now: number, rand: Rand) {
  const roles: RoleId[] = [];
  for (const r of special) for (let i = 0; i < t.settings.roles[r]; i++) roles.push(r);
  while (roles.length < t.players.length) roles.push("villager");
  const dealt = shuffle(roles, rand);
  t.players.forEach((p, i) => {
    Object.assign(p, { role: dealt[i]!, alive: true, turned: false, shown: false, canVote: true, ready: false });
  });
  Object.assign(t, {
    day: 0,
    actor: null,
    pending: [],
    lovers: null,
    sheriff: null,
    elected: false,
    lastGuarded: null,
    potions: { heal: true, poison: true },
    elderLives: 1,
    cubBonus: false,
    night: freshNight(),
    votes: {},
    notes: {},
    seen: {},
    log: [],
    chat: t.chat.filter((c) => c.channel === "all"),
    winner: null,
  });
  const wolves = t.players.filter((p) => isWolf(p.role));
  for (const p of t.players) {
    note(t, p.id, `You are the ${ROLES[p.role!].name}. ${ROLES[p.role!].blurb}`);
    if (isWolf(p.role) && wolves.length > 1)
      note(
        t,
        p.id,
        `Your pack: ${wolves
          .filter((w) => w.id !== p.id)
          .map((w) => w.name)
          .join(", ")}.`,
      );
  }
  log(t, "info", `The cards are dealt: ${t.players.length} players. Look at yours, and keep it to yourself.`, now);
  setPhase(t, "deal", now + DEAL_MS);
}

function backToLobby(t: Table, now: number) {
  t.players = t.players.filter((p) => p.connected).map((p) => ({ ...seatFor(p), connected: true }) satisfies Player);
  if (!find(t, t.host)) t.host = nextHost(t);
  Object.assign(t, {
    phase: "lobby",
    deadline: null,
    day: 0,
    actor: null,
    pending: [],
    lovers: null,
    sheriff: null,
    votes: {},
    notes: {},
    seen: {},
    winner: null,
    night: freshNight(),
  });
  log(t, "info", "Back to the table. Same village, new cards.", now);
}

function setPhase(t: Table, phase: Phase, deadline: number | null) {
  t.phase = phase;
  t.deadline = deadline;
  t.votes = {};
  for (const p of t.players) p.ready = false;
}

function startNight(t: Table, now: number, rand: Rand) {
  t.day += 1;
  t.night = freshNight(t.cubBonus ? 2 : 1);
  t.cubBonus = false;
  log(t, "night", `Night ${t.day}. Everyone closes their eyes.`, now);
  nextStep(t, now, rand, null);
}

const STEP_ROLE: Record<NightStep, (r: RoleId | null) => boolean> = {
  cupid: (r) => r === "cupid",
  seer: (r) => r === "seer",
  guard: (r) => r === "bodyguard",
  wolves: isWolf,
};

/** Who wakes on this turn of the night. */
function stepActors(t: Table, step: NightStep): Player[] {
  if (step === "cupid" && (t.day !== 1 || t.lovers)) return [];
  return alive(t).filter((p) => STEP_ROLE[step](p.role));
}

/**
 * The next role's turn after `after`. A role nobody was dealt is skipped; so is a dead one's when the dead show their
 * roles. When they don't, the narrator still calls a dead role and waits a little, so the table can't tell.
 */
function nextStep(t: Table, now: number, rand: Rand, after: NightStep | null) {
  for (const step of NIGHT_STEPS.slice(after ? NIGHT_STEPS.indexOf(after) + 1 : 0)) {
    if (step === "cupid" && (t.day !== 1 || t.lovers)) continue;
    if (!t.players.some((p) => STEP_ROLE[step](p.role))) continue;
    const awake = stepActors(t, step);
    if (!awake.length && t.settings.reveal) continue;
    t.night.step = step;
    const call: Record<NightStep, string> = {
      cupid: "Cupid wakes, and draws the bow: two people will fall in love.",
      seer: "The Seer wakes, and looks into someone's house.",
      guard: "The Bodyguard wakes, and keeps watch over someone.",
      wolves:
        t.night.kills === 2
          ? "The wolves wake, angry: tonight they will take two."
          : "The wolves wake, and choose who to eat.",
    };
    log(t, "night", call[step], now);
    const pretend = Math.min(t.settings.night, 6 + ((t.day * 7 + NIGHT_STEPS.indexOf(step) * 3) % 5));
    setPhase(t, "night", now + (awake.length ? t.settings.night : pretend) * SEC);
    return;
  }
  t.night.step = null;
  endNight(t, now, rand);
}

/** A turn of the night is over: Cupid's arrow lands, then the next role wakes. */
function endStep(t: Table, now: number, rand: Rand) {
  const step = t.night.step;
  if (!step) return endNight(t, now, rand);
  if (step === "cupid") bindLovers(t);
  nextStep(t, now, rand, step);
}

function bindLovers(t: Table) {
  if (t.night.cupid?.length !== 2 || t.lovers) return;
  const [a, b] = t.night.cupid.map((id) => find(t, id)!) as [Player, Player];
  t.lovers = [a.id, b.id];
  note(t, a.id, `Cupid's arrow: you love ${b.name}. If one of you dies, so does the other.`);
  note(t, b.id, `Cupid's arrow: you love ${a.name}. If one of you dies, so does the other.`);
}

/** Who has something to do now (on a table from before the night had turns, everyone with a night power). */
function nightActors(t: Table): Player[] {
  if (t.night.step) return stepActors(t, t.night.step);
  return alive(t).filter(
    (p) =>
      isWolf(p.role) || p.role === "seer" || p.role === "bodyguard" || (p.role === "cupid" && t.day === 1 && !t.lovers),
  );
}

function nightDone(t: Table, p: Player): boolean {
  // The pack is done when every wolf has picked, and they all picked the same.
  if (isWolf(p.role)) {
    const mine = [...(t.night.wolf[String(p.id)] ?? [])].sort().join(",");
    return (
      mine !== "" &&
      alive(t)
        .filter((w) => isWolf(w.role))
        .every((w) => [...(t.night.wolf[String(w.id)] ?? [])].sort().join(",") === mine)
    );
  }
  if (p.role === "seer") return t.night.seer !== null;
  if (p.role === "bodyguard") return t.night.guard !== null;
  if (p.role === "cupid") return t.night.cupid !== null;
  return true;
}

/** What this player is being asked to choose right now, if anything. */
export type Ask = {
  kind: "wolf" | "seer" | "guard" | "cupid" | "vote" | "election" | "hunter" | "badge";
  /** How many to pick. */
  pick: number;
  /** Who may be picked; 0 means "nobody" where that is allowed. */
  choices: number[];
  chosen: number[];
  /** Picked and locked in (the Seer can't look twice). */
  locked: boolean;
};

export function askFor(t: Table, p: Player | undefined): Ask | null {
  if (!p) return null;
  const living = alive(t);
  const ids = (xs: Player[]) => xs.map((x) => x.id);
  // (a table from before the night had turns has no step: everyone acts at once)
  const turn = (s: NightStep) => !t.night.step || t.night.step === s;
  if (t.phase === "night" && p.alive) {
    if (isWolf(p.role) && turn("wolves"))
      return {
        kind: "wolf",
        pick: t.night.kills,
        choices: ids(living.filter((x) => !isWolf(x.role))),
        chosen: t.night.wolf[String(p.id)] ?? [],
        locked: false,
      };
    if (p.role === "seer" && turn("seer"))
      return {
        kind: "seer",
        pick: 1,
        choices: ids(living.filter((x) => x.id !== p.id)),
        chosen: t.night.seer ? [t.night.seer] : [],
        locked: t.night.seer !== null,
      };
    if (p.role === "bodyguard" && turn("guard"))
      return {
        kind: "guard",
        pick: 1,
        choices: ids(living.filter((x) => x.id !== t.lastGuarded)),
        chosen: t.night.guard ? [t.night.guard] : [],
        locked: false,
      };
    if (p.role === "cupid" && t.day === 1 && !t.lovers && turn("cupid"))
      return { kind: "cupid", pick: 2, choices: ids(living), chosen: t.night.cupid ?? [], locked: false };
  }
  if ((t.phase === "vote" || t.phase === "election") && p.alive && (t.phase === "election" || p.canVote))
    return {
      kind: t.phase,
      pick: 1,
      choices: [0, ...ids(living.filter((x) => t.phase === "election" || x.id !== p.id))],
      chosen: String(p.id) in t.votes ? [t.votes[String(p.id)]!] : [],
      locked: false,
    };
  if ((t.phase === "hunter" || t.phase === "badge") && t.actor === p.id)
    return {
      kind: t.phase,
      pick: 1,
      choices: [0, ...ids(living.filter((x) => x.id !== p.id))],
      chosen: [],
      locked: false,
    };
  return null;
}

/** "the Witch", "a Werewolf": how the narrator names a role. */
const aRole = (r: RoleId) => (ROLES[r].max === 1 ? `the ${ROLES[r].name}` : `a ${ROLES[r].name}`);

function pick(t: Table, me: Player, picked: number[], now: number, rand: Rand): Result {
  const ask = askFor(t, me);
  if (!ask) return { error: "nothing to choose right now" };
  if (ask.locked) return { error: "you've already chosen" };
  const ids = [...new Set(picked)];
  if (ids.length !== ask.pick || ids.some((id) => !ask.choices.includes(id)))
    return { error: ask.pick === 2 ? "pick two players" : "pick someone at the table" };
  const one = ids[0]!;
  switch (ask.kind) {
    case "wolf":
      t.night.wolf[String(me.id)] = ids;
      break;
    case "seer": {
      t.night.seer = one;
      const seen = find(t, one)!;
      // A Cursed player looks like a villager until the wolves bite them.
      const looks: RoleId = seen.role === "cursed" ? "villager" : seen.role!;
      const mine = { ...(t.seen?.[String(me.id)] ?? {}), [String(one)]: looks };
      t.seen = { ...(t.seen ?? {}), [String(me.id)]: mine };
      note(t, me.id, `Night ${t.day}: ${seen.name} is ${aRole(looks)}.`);
      break;
    }
    case "guard":
      t.night.guard = one;
      break;
    case "cupid":
      t.night.cupid = ids;
      break;
    case "vote":
    case "election":
      t.votes[String(me.id)] = one;
      // Everyone has voted: the clock skips to its last seconds (a vote can still change until then).
      if (alive(t).every((p) => !askFor(t, p) || String(p.id) in t.votes)) hurry(t, now);
      return ok;
    case "hunter": {
      t.actor = null;
      const target = find(t, one);
      if (target?.alive) {
        log(t, "death", `${me.name}, the Hunter, takes ${named(t, target)} down too.`, now);
        kill(t, target, now);
      } else log(t, "info", `${me.name}, the Hunter, lowers the gun.`, now);
      proceed(t, now, rand);
      return ok;
    }
    case "badge": {
      t.actor = null;
      const heir = find(t, one);
      if (heir?.alive) {
        t.sheriff = heir.id;
        log(t, "info", `${me.name} hands the sheriff's badge to ${heir.name}.`, now);
      } else {
        t.sheriff = null;
        log(t, "info", `${me.name} tears up the sheriff's badge.`, now);
      }
      proceed(t, now, rand);
      return ok;
    }
  }
  if (t.phase === "night" && nightActors(t).every((p) => nightDone(t, p))) hurry(t, now);
  return ok;
}

/** When everything there is to do in a phase is done, the rest of it is skipped. */
export const LAST_MS = 5 * SEC;

/** Everyone has done what they had to: the clock skips to the phase's last few seconds (never later than it was). */
function hurry(t: Table, now: number) {
  if (t.deadline !== null) t.deadline = Math.min(t.deadline, now + LAST_MS);
}

function witch(t: Table, me: Player, heal: number | null, poison: number | null, now: number): Result {
  if (t.phase !== "witch" || me.role !== "witch" || !me.alive || t.night.witchDone) return { error: "not now" };
  if (heal !== null && (!t.potions.heal || !t.night.attacked.includes(heal)))
    return { error: "you can only save someone the wolves attacked" };
  if (poison !== null) {
    const target = find(t, poison);
    if (!t.potions.poison || !target?.alive || poison === me.id) return { error: "you can't poison them" };
  }
  t.night.heal = heal;
  t.night.poison = poison;
  t.night.witchDone = true;
  if (heal !== null) t.potions.heal = false;
  if (poison !== null) t.potions.poison = false;
  // the night ends when its last seconds run out (`tick`), like every other phase whose work is done
  hurry(t, now);
  return ok;
}

function wolfTargets(t: Table, rand: Rand): number[] {
  const tally = new Map<number, number>();
  for (const w of alive(t).filter((p) => isWolf(p.role)))
    for (const id of t.night.wolf[String(w.id)] ?? []) tally.set(id, (tally.get(id) ?? 0) + 1);
  // Most votes first; a tie is settled by chance.
  const ranked = shuffle([...tally.entries()], rand).sort((a, b) => b[1] - a[1]);
  return ranked
    .slice(0, t.night.kills)
    .map(([id]) => id)
    .filter((id) => find(t, id)?.alive);
}

function endNight(t: Table, now: number, rand: Rand) {
  t.night.step = null;
  t.night.attacked = wolfTargets(t, rand);
  bindLovers(t);
  if (t.night.guard) t.lastGuarded = t.night.guard;
  else t.lastGuarded = null;
  const witchP = t.players.find((p) => p.role === "witch");
  if (!witchP) return resolveNight(t, now, rand);
  if (witchP.alive && (t.potions.heal || t.potions.poison)) {
    const attacked = t.night.attacked.map((id) => find(t, id)!.name);
    note(
      t,
      witchP.id,
      attacked.length
        ? `Night ${t.day}: the wolves attacked ${attacked.join(" and ")}.`
        : `Night ${t.day}: the wolves attacked nobody.`,
    );
    log(t, "night", "The Witch wakes, and sees who the wolves attacked.", now);
    setPhase(t, "witch", now + t.settings.night * SEC);
    return;
  }
  // A witch with nothing left to do, or a dead one: wait a little anyway, unless roles are known, so the table
  // can't tell.
  if (t.settings.reveal && !witchP.alive) return resolveNight(t, now, rand);
  log(t, "night", "The Witch wakes, and sees who the wolves attacked.", now);
  setPhase(t, "witch", now + Math.round(6 + rand() * 6) * SEC);
}

function resolveNight(t: Table, now: number, rand: Rand) {
  const deaths: Player[] = [];
  for (const id of t.night.attacked) {
    const p = find(t, id);
    if (!p?.alive) continue;
    if (id === t.night.guard || id === t.night.heal) continue;
    if (p.role === "elder" && t.elderLives > 0) {
      t.elderLives -= 1;
      note(t, p.id, `Night ${t.day}: the wolves came for you, and you fought them off. Next time you won't.`);
      continue;
    }
    if (p.role === "cursed") {
      p.role = "werewolf";
      p.turned = true;
      note(t, p.id, `Night ${t.day}: the wolves bit you. You wake up one of them: you are a werewolf now.`);
      for (const w of t.players.filter((x) => isWolf(x.role) && x.id !== p.id && x.alive))
        note(t, w.id, `Night ${t.day}: ${p.name} was Cursed, and has joined the pack.`);
      continue;
    }
    deaths.push(p);
  }
  const poisoned = t.night.poison ? find(t, t.night.poison) : undefined;
  if (poisoned?.alive && !deaths.includes(poisoned)) deaths.push(poisoned);

  log(t, "day", `Day ${t.day}. The sun comes up.`, now);
  if (deaths.length === 0) log(t, "info", "Nobody died last night.", now);
  for (const p of shuffle(deaths, rand)) {
    if (!p.alive) continue;
    log(t, "death", `${named(t, p)} was found dead.`, now);
    kill(t, p, now);
  }
  t.resume = "day";
  setPhase(t, "dawn", now + DAWN_MS);
}

/** Someone dies, and whatever follows from it: grief, the Hunter's shot, the badge, the wolf cub's revenge. */
function kill(t: Table, p: Player, now: number) {
  if (!p.alive) return;
  p.alive = false;
  p.ready = false;
  if (t.settings.reveal) p.shown = true;
  if (p.role === "hunter") t.pending.push({ kind: "hunter", id: p.id });
  if (t.sheriff === p.id) t.pending.push({ kind: "badge", id: p.id });
  if (p.role === "wolfcub") t.cubBonus = true;
  if (t.lovers?.includes(p.id)) {
    const other = find(t, t.lovers[0] === p.id ? t.lovers[1] : t.lovers[0]);
    if (other?.alive) {
      log(t, "death", `${named(t, other)} dies of a broken heart.`, now);
      kill(t, other, now);
    }
  }
}

/** After a dawn or a verdict: last acts of the dead, then the end of the game, or the next part of it. */
function proceed(t: Table, now: number, rand: Rand) {
  while (t.pending.length) {
    const next = t.pending.shift()!;
    const who = find(t, next.id);
    if (!who) continue;
    if (next.kind === "badge" && t.sheriff !== who.id) continue;
    t.actor = who.id;
    log(
      t,
      "info",
      next.kind === "hunter"
        ? `${who.name} was the Hunter, and takes aim at someone…`
        : `${who.name} was the sheriff, and passes the badge on.`,
      now,
    );
    setPhase(t, next.kind, now + (next.kind === "hunter" ? HUNTER_MS : BADGE_MS));
    return;
  }
  t.actor = null;
  const w = winnerOf(t);
  if (w) return finish(t, w, now);
  if (t.resume === "night") return startNight(t, now, rand);
  if (t.settings.sheriff && !t.elected) {
    t.elected = true;
    log(t, "day", "Before anything else, the village elects a sheriff. Their vote counts twice.", now);
    setPhase(t, "election", now + ELECTION_MS);
    return;
  }
  startDiscussion(t, now);
}

function startDiscussion(t: Table, now: number) {
  log(t, "day", "Talk it over. Who do you think they are?", now);
  setPhase(t, "discussion", now + t.settings.discussion * SEC);
}

function startVote(t: Table, now: number) {
  log(t, "day", "Time to vote. Pick who leaves the village, or nobody.", now);
  setPhase(t, "vote", now + t.settings.vote * SEC);
}

function tallied(t: Table, weighted: boolean): Array<[number, number]> {
  const tally = new Map<number, number>();
  for (const [voter, target] of Object.entries(t.votes)) {
    const weight = weighted && t.sheriff === Number(voter) ? 2 : 1;
    tally.set(target, (tally.get(target) ?? 0) + weight);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]);
}

function resolveElection(t: Table, now: number, rand: Rand) {
  const ranked = tallied(t, false).filter(([id]) => id !== 0);
  const top = ranked.filter(([, n]) => n === ranked[0]?.[1]);
  const chosen = top.length ? find(t, top[Math.floor(rand() * top.length)]![0]) : undefined;
  if (chosen?.alive) {
    t.sheriff = chosen.id;
    log(t, "info", `${chosen.name} is the sheriff${top.length > 1 ? " (a tie, settled by a coin)" : ""}.`, now);
  } else log(t, "info", "Nobody wanted the badge. No sheriff, then.", now);
  startDiscussion(t, now);
}

function resolveVote(t: Table, now: number) {
  const ranked = tallied(t, true);
  const [first, second] = ranked;
  let out = first && first[0] !== 0 && (!second || second[1] < first[1]) ? find(t, first[0]) : undefined;
  // A tie between players: the sheriff's vote settles it, when it went to one of them.
  const tied = first ? ranked.filter(([, n]) => n === first[1]).map(([id]) => id) : [];
  const badge = t.sheriff !== null ? t.votes[String(t.sheriff)] : undefined;
  const broken =
    !out && tied.length > 1 && !tied.includes(0) && badge !== undefined && badge !== 0 && tied.includes(badge);
  if (broken) out = find(t, badge);
  t.resume = "night";
  if (broken && out) log(t, "day", `A tie. The sheriff's vote settles it.`, now);
  if (!out) {
    log(t, "day", ranked.length ? "No majority. Nobody leaves today." : "Nobody voted. Nobody leaves today.", now);
  } else if (out.role === "idiot" && out.canVote) {
    out.canVote = false;
    out.shown = true;
    log(
      t,
      "day",
      `The village votes out ${out.name}, and sees the Village idiot. They stay, but lose their vote.`,
      now,
    );
  } else if (out.role === "tanner") {
    out.shown = true;
    kill(t, out, now);
    log(t, "end", `The village votes out ${out.name}: the Tanner, who wanted exactly that.`, now);
    return finish(t, { team: "tanner", ids: [out.id] }, now);
  } else {
    log(t, "death", `The village votes out ${named(t, out)}.`, now);
    kill(t, out, now);
  }
  setPhase(t, "verdict", now + VERDICT_MS);
}

export function winnerOf(t: Table): Winner | null {
  const living = alive(t);
  if (living.length === 0) return { team: "nobody", ids: [] };
  const lovers = t.lovers;
  if (lovers) {
    const [a, b] = lovers.map((id) => find(t, id)!);
    const mixed = isWolf(a?.role) !== isWolf(b?.role);
    if (mixed && living.length === 2 && living.every((p) => lovers.includes(p.id)))
      return { team: "lovers", ids: [...lovers] };
  }
  const wolves = living.filter((p) => isWolf(p.role)).length;
  if (wolves === 0)
    return { team: "village", ids: t.players.filter((p) => !isWolf(p.role) && p.role !== "tanner").map((p) => p.id) };
  if (wolves >= living.length - wolves)
    return { team: "wolves", ids: t.players.filter((p) => isWolf(p.role)).map((p) => p.id) };
  return null;
}

function finish(t: Table, w: Winner, now: number) {
  t.winner = w;
  for (const p of t.players) p.shown = true;
  const text =
    w.team === "village"
      ? "The last wolf is gone. The village wins."
      : w.team === "wolves"
        ? "The wolves outnumber the village. The wolves win."
        : w.team === "lovers"
          ? "Only the lovers are left, together. The lovers win."
          : w.team === "tanner"
            ? "The Tanner wins alone."
            : "Nobody is left. Nobody wins.";
  log(t, "end", text, now);
  setPhase(t, "over", null);
}

/** The clock: moves the game on when a phase's time is up. Returns true when anything changed. */
export function tick(t: Table, now: number, rand: Rand): boolean {
  if (t.deadline === null || now < t.deadline) return false;
  switch (t.phase) {
    case "deal":
      startNight(t, now, rand);
      break;
    case "night":
      endStep(t, now, rand);
      break;
    case "witch":
      t.night.witchDone = true;
      resolveNight(t, now, rand);
      break;
    case "dawn":
    case "verdict":
      proceed(t, now, rand);
      break;
    case "hunter":
      log(t, "info", "The Hunter's hand shook. Nobody else dies.", now);
      t.actor = null;
      proceed(t, now, rand);
      break;
    case "badge":
      log(t, "info", "The badge falls in the mud. No sheriff now.", now);
      t.sheriff = null;
      t.actor = null;
      proceed(t, now, rand);
      break;
    case "election":
      resolveElection(t, now, rand);
      break;
    case "discussion":
      startVote(t, now);
      break;
    case "vote":
      resolveVote(t, now);
      break;
    default:
      t.deadline = null;
  }
  t.updatedAt = now;
  return true;
}

/* ---------- what each player sees ---------- */

export type PlayerView = {
  id: number;
  name: string;
  handle: string;
  avatar: string;
  connected: boolean;
  alive: boolean;
  /** Known to this viewer: their own, their pack's, the dead's (when shown), everyone's at the end. */
  role: RoleId | null;
  turned: boolean;
  canVote: boolean;
  ready: boolean;
  sheriff: boolean;
  /** This viewer's lover, or the viewer themself when they are one of the lovers. */
  lover: boolean;
  /** A computer player. */
  bot: boolean;
  /** The role is what this viewer, the Seer, saw in their house (a Cursed turns, and the look doesn't). */
  seen: boolean;
};

export type TableView = {
  code: string;
  host: number;
  settings: TableSettings;
  phase: Phase;
  deadline: number | null;
  /** The server's clock when this was sent, so the browser can count down without trusting its own. */
  now: number;
  day: number;
  /** Whose turn it is at night. */
  step: NightStep | null;
  actor: number | null;
  players: PlayerView[];
  /** This viewer, when they sit at the table. */
  me: { id: number; role: RoleId | null; alive: boolean; canVote: boolean; ready: boolean } | null;
  ask: Ask | null;
  /** The wolves' picks tonight, for the wolves. */
  pack: Record<string, number[]> | null;
  /** For the Witch, while she chooses. */
  witch: { attacked: number[]; heal: boolean; poison: boolean; done: boolean } | null;
  /** Open votes, in a vote or an election. */
  votes: Record<string, number> | null;
  notes: Array<{ day: number; text: string }>;
  log: LogLine[];
  chat: ChatLine[];
  /** Where this viewer's words would go now, or null when they must keep quiet. */
  channel: Channel | null;
  winner: Winner | null;
  /** Who this viewer's microphone reaches, and whose they may hear. */
  voice: { speakTo: number[]; hear: number[] };
  /** Whether newcomers need the host's password. */
  locked: boolean;
};

/** Whether `from`'s voice reaches `to` now. The same rule as the chat: night belongs to the wolves, death to the dead. */
export function canSpeakTo(t: Table, from: Player, to: Player): boolean {
  if (from.id === to.id) return false;
  if (t.phase === "lobby" || t.phase === "over") return true;
  if (!from.alive) return !to.alive;
  if (NIGHT_PHASES.includes(t.phase)) return isWolf(from.role) && (isWolf(to.role) || !to.alive);
  return true;
}

export function viewFor(t: Table, viewer: number, now: number): TableView {
  const me = find(t, viewer);
  const over = t.phase === "over";
  const lover = me && t.lovers?.includes(me.id) ? t.lovers : null;
  const sees = (p: Player) =>
    over ||
    p.id === viewer ||
    p.shown ||
    (me && isWolf(me.role) && isWolf(p.role)) ||
    (me && !me.alive && t.settings.reveal);
  const vision = me ? t.seen?.[String(me.id)] : undefined;
  const players = t.players.map(
    (p): PlayerView => ({
      id: p.id,
      name: p.name,
      handle: p.handle,
      avatar: p.avatar,
      connected: p.connected,
      alive: p.alive,
      role: sees(p) ? p.role : (vision?.[String(p.id)] ?? null),
      turned: sees(p) ? p.turned : false,
      canVote: p.canVote,
      ready: p.ready,
      sheriff: t.sheriff === p.id,
      lover: Boolean(lover?.includes(p.id) || (over && t.lovers?.includes(p.id))),
      bot: Boolean(p.bot),
      seen: !sees(p) && Boolean(vision?.[String(p.id)]),
    }),
  );
  const wolfView = me && isWolf(me.role) && me.alive && t.phase === "night";
  return {
    code: t.code,
    host: t.host,
    settings: t.settings,
    phase: t.phase,
    deadline: t.deadline,
    now,
    day: t.day,
    step: t.phase === "night" ? (t.night.step ?? null) : null,
    actor: t.actor,
    players,
    me: me ? { id: me.id, role: me.role, alive: me.alive, canVote: me.canVote, ready: me.ready } : null,
    ask: askFor(t, me),
    pack: wolfView ? t.night.wolf : null,
    witch:
      me?.role === "witch" && me.alive && t.phase === "witch"
        ? {
            attacked: t.potions.heal || t.potions.poison ? t.night.attacked : [],
            heal: t.potions.heal,
            poison: t.potions.poison,
            done: t.night.witchDone,
          }
        : null,
    votes: t.phase === "vote" || t.phase === "election" ? t.votes : null,
    notes: t.notes[String(viewer)] ?? [],
    log: t.log,
    chat: t.chat.filter((c) => canRead(t, me, c)),
    channel: me ? chatChannel(t, me) : null,
    winner: t.winner,
    voice: me
      ? {
          speakTo: t.players.filter((p) => canSpeakTo(t, me, p)).map((p) => p.id),
          hear: t.players.filter((p) => canSpeakTo(t, p, me)).map((p) => p.id),
        }
      : { speakTo: [], hear: [] },
    locked: Boolean(t.lock),
  };
}

/** What the desktop lists for an open table. */
export type TableListing = {
  code: string;
  host: string;
  players: number;
  seats: number;
  phase: Phase;
  updatedAt: number;
  /** Sitting down needs the host's password. */
  locked: boolean;
};

export const listingOf = (t: Table): TableListing => ({
  code: t.code,
  host: find(t, t.host)?.name ?? "",
  players: t.players.length,
  seats: t.settings.seats,
  phase: t.phase,
  updatedAt: t.updatedAt,
  locked: Boolean(t.lock),
});

/* ---------- computer players' moves ---------- */

/**
 * What the computer players do now, if anything: each one who has something to choose chooses (a little like a
 * person would: wolves follow the pack, voters lean towards whoever is already accused), and each one at the
 * discussion says it is ready. The table runs these a few seconds after things change, so they don't answer at once.
 */
export function botMoves(t: Table, rand: Rand): Array<{ id: number; cmd: TableCommand }> {
  const moves: Array<{ id: number; cmd: TableCommand }> = [];
  const any = <T>(xs: T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  for (const b of t.players) {
    if (!b.bot) continue;
    if (t.phase === "discussion" && b.alive && !b.ready) {
      moves.push({ id: b.id, cmd: { t: "ready", ready: true } });
      continue;
    }
    if (t.phase === "witch" && b.alive && b.role === "witch" && !t.night.witchDone) {
      const saveable = t.potions.heal ? t.night.attacked : [];
      const heal = saveable.length && rand() < 0.5 ? (any(saveable) ?? null) : null;
      const targets = alive(t).filter((p) => p.id !== b.id && !t.night.attacked.includes(p.id));
      const poison = t.potions.poison && rand() < 0.15 ? (any(targets)?.id ?? null) : null;
      moves.push({ id: b.id, cmd: { t: "witch", heal, poison } });
      continue;
    }
    const ask = askFor(t, b);
    if (!ask || ask.locked || ask.chosen.length) continue;
    const real = ask.choices.filter((id) => id !== 0);
    if (!real.length) {
      if (ask.choices.includes(0)) moves.push({ id: b.id, cmd: { t: "pick", ids: [0] } });
      continue;
    }
    let ids: number[];
    if (ask.kind === "wolf") {
      // the pack agrees: follow what the other wolves chose, if they did
      const theirs = Object.values(t.night.wolf).find((xs) => xs.length === ask.pick);
      ids = theirs ?? [...real].sort(() => rand() - 0.5).slice(0, ask.pick);
    } else if (ask.kind === "vote" || ask.kind === "election") {
      const counts = new Map<number, number>();
      for (const target of Object.values(t.votes)) if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
      const lead = [...counts].filter(([id]) => real.includes(id)).sort((a, b) => b[1] - a[1])[0]?.[0];
      ids = [lead !== undefined && rand() < 0.6 ? lead : (any(real) ?? real[0]!)];
    } else ids = [...real].sort(() => rand() - 0.5).slice(0, ask.pick);
    moves.push({ id: b.id, cmd: { t: "pick", ids } });
  }
  return moves;
}

/* ---------- the wire ---------- */

export const TABLE_CODE = /^[a-z0-9]{6}$/;

/** A table's password: what the host may set (null takes it off). */
export const tablePassword = z.string().trim().min(4, "at least four characters").max(40);

/**
 * What a browser sends: a command for the game, the host's password, a WebRTC message for another player, or a
 * fresh ticket. A socket at a table only lives as long as its player is still signed in: the browser sends a new
 * ticket every few minutes (the web server gives one only to a valid, current session), and a socket that stops
 * is let go.
 */
export const tableMessage = z.union([
  tableCommand,
  z.object({ t: z.literal("renew"), ticket: z.string().max(400) }),
  z.object({ t: z.literal("lock"), password: tablePassword.nullable() }),
  z.object({
    t: z.literal("signal"),
    to: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
  }),
]);
export type TableMessage = z.infer<typeof tableMessage>;

/** What the table sends a browser. */
export type TableEvent =
  | { t: "view"; view: TableView }
  | { t: "signal"; from: number; data: Record<string, unknown> }
  | { t: "error"; error: string }
  | { t: "closed"; reason: string };
