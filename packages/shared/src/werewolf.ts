import { z } from "zod";

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
    blurb: "Each night, look at one player and learn whether they are a wolf.",
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
    blurb: "A villager, until the wolves bite you: then you wake up one of them. The Seer sees a villager.",
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
  /** Seconds. */
  night: z.number().int().min(20).max(120).default(45),
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
  };
  /** Votes in a vote or an election: voter → target (0: nobody). */
  votes: Record<string, number>;
  notes: Record<string, Array<{ day: number; text: string }>>;
  log: LogLine[];
  chat: ChatLine[];
  seq: number;
  winner: Winner | null;
};

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
  if (t.phase !== "lobby") return { error: "this game has already started" };
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
function leave(t: Table, id: number, now: number) {
  if (t.phase === "lobby" || t.phase === "over") {
    t.players = t.players.filter((p) => p.id !== id);
    if (t.host === id) t.host = t.players.find((p) => p.connected)?.id ?? t.players[0]?.id ?? 0;
    autoRoles(t);
  } else setConnected(t, id, false, now);
  t.updatedAt = now;
}

/* ---------- commands ---------- */

export const tableCommand = z.discriminatedUnion("t", [
  z.object({ t: z.literal("settings"), settings: tableSettings }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("kick"), id: z.number().int() }),
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
      if (!host || t.phase !== "lobby" || cmd.id === by) return { error: "you can't do that" };
      t.players = t.players.filter((p) => p.id !== cmd.id);
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
      const r = witch(t, me, cmd.heal, cmd.poison, now, rand);
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
  if (!find(t, t.host)) t.host = t.players[0]?.id ?? 0;
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

function startNight(t: Table, now: number) {
  t.day += 1;
  t.night = freshNight(t.cubBonus ? 2 : 1);
  t.cubBonus = false;
  log(
    t,
    "night",
    t.night.kills === 2
      ? `Night ${t.day}. The wolves are angry tonight: they will take two.`
      : `Night ${t.day}. Everyone closes their eyes.`,
    now,
  );
  setPhase(t, "night", now + t.settings.night * SEC);
}

/** Who has something to do tonight. */
function nightActors(t: Table): Player[] {
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
  if (t.phase === "night" && p.alive) {
    if (isWolf(p.role))
      return {
        kind: "wolf",
        pick: t.night.kills,
        choices: ids(living.filter((x) => !isWolf(x.role))),
        chosen: t.night.wolf[String(p.id)] ?? [],
        locked: false,
      };
    if (p.role === "seer")
      return {
        kind: "seer",
        pick: 1,
        choices: ids(living.filter((x) => x.id !== p.id)),
        chosen: t.night.seer ? [t.night.seer] : [],
        locked: t.night.seer !== null,
      };
    if (p.role === "bodyguard")
      return {
        kind: "guard",
        pick: 1,
        choices: ids(living.filter((x) => x.id !== t.lastGuarded)),
        chosen: t.night.guard ? [t.night.guard] : [],
        locked: false,
      };
    if (p.role === "cupid" && t.day === 1 && !t.lovers)
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
      note(t, me.id, `Night ${t.day}: ${seen.name} ${isWolf(seen.role) ? "IS a werewolf." : "is not a werewolf."}`);
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
      if (alive(t).every((p) => !askFor(t, p) || String(p.id) in t.votes)) {
        if (t.phase === "vote") resolveVote(t, now);
        else resolveElection(t, now, rand);
      }
      return ok;
    case "hunter": {
      t.actor = null;
      const target = find(t, one);
      if (target?.alive) {
        log(t, "death", `${me.name}, the Hunter, takes ${named(t, target)} down too.`, now);
        kill(t, target, now);
      } else log(t, "info", `${me.name}, the Hunter, lowers the gun.`, now);
      proceed(t, now);
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
      proceed(t, now);
      return ok;
    }
  }
  if (t.phase === "night" && earlyNight(t) && nightActors(t).every((p) => nightDone(t, p))) endNight(t, now, rand);
  return ok;
}

/**
 * Whether night may end before its time is up when everyone has acted. Not when roles stay hidden on death: a
 * night that ends early would tell the table that the Seer, say, is dead.
 */
const earlyNight = (t: Table) => t.settings.reveal;

function witch(t: Table, me: Player, heal: number | null, poison: number | null, now: number, rand: Rand): Result {
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
  resolveNight(t, now, rand);
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
  t.night.attacked = wolfTargets(t, rand);
  if (t.night.cupid?.length === 2 && !t.lovers) {
    const [a, b] = t.night.cupid.map((id) => find(t, id)!) as [Player, Player];
    t.lovers = [a.id, b.id];
    note(t, a.id, `Cupid's arrow: you love ${b.name}. If one of you dies, so does the other.`);
    note(t, b.id, `Cupid's arrow: you love ${a.name}. If one of you dies, so does the other.`);
  }
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
    setPhase(t, "witch", now + Math.max(15, Math.round(t.settings.night / 2)) * SEC);
    return;
  }
  // A witch with nothing left to do, or a dead one: wait a little anyway, unless roles are known, so the table
  // can't tell.
  if (t.settings.reveal && !witchP.alive) return resolveNight(t, now, rand);
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
function proceed(t: Table, now: number) {
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
  if (t.resume === "night") return startNight(t, now);
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
  const out = first && first[0] !== 0 && (!second || second[1] < first[1]) ? find(t, first[0]) : undefined;
  t.resume = "night";
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
      startNight(t, now);
      break;
    case "night":
      endNight(t, now, rand);
      break;
    case "witch":
      t.night.witchDone = true;
      resolveNight(t, now, rand);
      break;
    case "dawn":
    case "verdict":
      proceed(t, now);
      break;
    case "hunter":
      log(t, "info", "The Hunter's hand shook. Nobody else dies.", now);
      t.actor = null;
      proceed(t, now);
      break;
    case "badge":
      log(t, "info", "The badge falls in the mud. No sheriff now.", now);
      t.sheriff = null;
      t.actor = null;
      proceed(t, now);
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
  const players = t.players.map(
    (p): PlayerView => ({
      id: p.id,
      name: p.name,
      handle: p.handle,
      avatar: p.avatar,
      connected: p.connected,
      alive: p.alive,
      role: sees(p) ? p.role : null,
      turned: sees(p) ? p.turned : false,
      canVote: p.canVote,
      ready: p.ready,
      sheriff: t.sheriff === p.id,
      lover: Boolean(lover?.includes(p.id) || (over && t.lovers?.includes(p.id))),
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
};

export const listingOf = (t: Table): TableListing => ({
  code: t.code,
  host: find(t, t.host)?.name ?? "",
  players: t.players.length,
  seats: t.settings.seats,
  phase: t.phase,
  updatedAt: t.updatedAt,
});

/* ---------- the wire ---------- */

export const TABLE_CODE = /^[a-z0-9]{6}$/;

/** What a browser sends: a command for the game, or a WebRTC message for another player. */
export const tableMessage = z.union([
  tableCommand,
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
