import { describe, expect, it } from "vitest";
import {
  askFor,
  botMoves,
  cannotStart,
  command,
  defaultSettings,
  isWolf,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NIGHT_STEPS,
  type NightStep,
  newTable,
  ROLE_ORDER,
  ROLES,
  type RoleId,
  type Table,
  tick,
  viewFor,
  winnerOf,
} from "./werewolf";

// Hundreds of whole games played by computer players, with every table size, mixes of roles and settings, checking
// the rules hold at every turn: the night goes round the roles in order, only whoever's turn it is can act, the dead
// do nothing, lovers die together, nobody is told what they mayn't know, and every game ends with the right winner.

const seat = (id: number) => ({ id, name: `P${id}`, handle: `p${id}`, avatar: "a" });

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const STEP_ROLE: Record<NightStep, (r: RoleId | null) => boolean> = {
  cupid: (r) => r === "cupid",
  seer: (r) => r === "seer",
  guard: (r) => r === "bodyguard",
  wolves: isWolf,
};

/** A table of n, every seat a computer player, with a random set of roles that can start. */
function table(n: number, rand: () => number): Table {
  const settings = { ...defaultSettings(), seats: MAX_PLAYERS };
  settings.reveal = rand() < 0.6;
  settings.sheriff = rand() < 0.7;
  settings.auto = false;
  for (const r of ROLE_ORDER) if (r !== "villager") settings.roles[r] = 0;
  settings.roles.werewolf = 1 + Math.floor(rand() * Math.max(1, Math.floor((n - 1) / 3)));
  for (const r of ROLE_ORDER) {
    if (r === "villager" || r === "werewolf") continue;
    if (rand() < 0.5) settings.roles[r] = 1;
  }
  // too many roles for the table: drop some until it can start
  for (const r of [...ROLE_ORDER].reverse())
    if (cannotStart(settings, n) && r !== "werewolf" && r !== "villager") settings.roles[r] = 0;
  expect(cannotStart(settings, n)).toBeNull();
  const t = newTable("sim001", seat(1), 0, settings);
  for (let i = 1; i < n; i++) expect(command(t, 1, { t: "bot", add: true }, 0, rand)).toEqual({ ok: true });
  t.settings.auto = false;
  t.settings.roles = settings.roles;
  t.settings.reveal = settings.reveal;
  t.settings.sheriff = settings.sheriff;
  expect(command(t, 1, { t: "start" }, 0, rand)).toEqual({ ok: true });
  t.players[0]!.bot = true;
  return t;
}

function play(seed: number) {
  const rand = seeded(seed);
  const n = MIN_PLAYERS + Math.floor(rand() * (MAX_PLAYERS - MIN_PLAYERS + 1));
  const t = table(n, rand);
  let now = 0;
  let night = -1;
  let lastStep = -1;
  for (let round = 0; round < 3000 && t.phase !== "over"; round++) {
    // the night goes round the roles in order, once each, and only for roles that were dealt
    if (t.phase === "night" && t.night.step) {
      if (night !== t.day) {
        night = t.day;
        lastStep = -1;
      }
      const at = NIGHT_STEPS.indexOf(t.night.step);
      expect(at).toBeGreaterThanOrEqual(lastStep);
      lastStep = at;
      expect(t.players.some((p) => STEP_ROLE[t.night.step!](p.role))).toBe(true);
      if (t.night.step === "cupid") expect(t.day).toBe(1);
      // only whoever's turn it is is asked anything
      for (const p of t.players) {
        const ask = askFor(t, p);
        if (ask) {
          expect(p.alive).toBe(true);
          expect(STEP_ROLE[t.night.step](p.role)).toBe(true);
        }
      }
    }
    // the dead are never asked to choose (but the Hunter's last shot and the badge, which are theirs)
    for (const p of t.players) {
      const ask = askFor(t, p);
      if (ask && !p.alive) expect(["hunter", "badge"]).toContain(ask.kind);
    }
    // lovers die together; nobody sees a living player's role they mayn't
    if (t.lovers) {
      const [a, b] = t.lovers.map((id) => t.players.find((p) => p.id === id)!);
      if (t.phase !== "hunter" && t.phase !== "badge") expect(a!.alive).toBe(b!.alive);
    }
    for (const viewer of t.players) {
      const v = viewFor(t, viewer.id, now);
      for (const pv of v.players) {
        if (pv.role === null || pv.id === viewer.id) continue;
        const real = t.players.find((p) => p.id === pv.id)!;
        const allowed =
          real.shown ||
          (isWolf(viewer.role) && isWolf(real.role)) ||
          (!viewer.alive && t.settings.reveal) ||
          (pv.seen && Boolean(t.seen?.[String(viewer.id)]?.[String(pv.id)]));
        expect(allowed).toBe(true);
      }
      // a living villager hears nobody at night
      if (["night", "witch"].includes(t.phase) && viewer.alive && !isWolf(viewer.role))
        expect(v.voice.speakTo).toEqual([]);
    }
    const moves = botMoves(t, rand);
    for (const { id, cmd } of moves) command(t, id, cmd, now, rand);
    if (!moves.length) {
      now = (t.deadline ?? now) + 1;
      tick(t, now, rand);
    }
  }
  expect(t.phase).toBe("over");
  const w = t.winner!;
  expect(w).toBeTruthy();
  if (w.team === "village") expect(t.players.filter((p) => p.alive && isWolf(p.role))).toHaveLength(0);
  if (w.team === "wolves") {
    const living = t.players.filter((p) => p.alive);
    expect(living.filter((p) => isWolf(p.role)).length * 2).toBeGreaterThanOrEqual(living.length);
  }
  if (w.team !== "tanner") expect(winnerOf(t)?.team).toBe(w.team);
  // the winners are the right team
  for (const id of w.ids) {
    const p = t.players.find((x) => x.id === id)!;
    if (w.team === "wolves") expect(isWolf(p.role)).toBe(true);
    if (w.team === "village") expect(ROLES[p.role!].team === "village" && !isWolf(p.role)).toBe(true);
  }
  // everyone's card is shown at the end
  expect(viewFor(t, 1, now).players.every((p) => p.role !== null)).toBe(true);
  return { n, days: t.day, team: w.team };
}

describe("whole games, played by computer players", () => {
  it("keep to the rules at every turn, and always end with the right winner", () => {
    const teams = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed++) {
      const r = play(seed * 7919);
      teams.set(r.team, (teams.get(r.team) ?? 0) + 1);
    }
    // both sides win sometimes
    expect(teams.get("village") ?? 0).toBeGreaterThan(0);
    expect(teams.get("wolves") ?? 0).toBeGreaterThan(0);
    // (three hundred games take a few seconds; more on a busy machine)
  }, 120_000);
});
