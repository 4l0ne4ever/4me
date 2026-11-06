import { describe, expect, it } from "vitest";
import {
  arrive,
  BOT_BASE,
  botMoves,
  cannotStart,
  command,
  defaultSettings,
  LAST_MS,
  newTable,
  type RoleId,
  suggestRoles,
  TABLE_BANNED,
  type Table,
  type TableCommand,
  tick,
  viewFor,
} from "./werewolf";

const seat = (id: number) => ({ id, name: `P${id}`, handle: `p${id}`, avatar: "a" });
// Always the same "chance", so games replay the same way.
const rand = () => 0.42;
let clock = 1_000_000;

/** A table of n players, dealt these roles in seat order (villagers for the rest), at night 1. */
function game(roles: RoleId[], opts: Partial<Table["settings"]> = {}): Table {
  const n = Math.max(roles.length, 5);
  const t = newTable("abc123", seat(1), clock, { ...defaultSettings(), seats: 16, sheriff: false, ...opts });
  for (let i = 2; i <= n; i++) arrive(t, seat(i), clock);
  t.settings.roles = Object.fromEntries(Object.keys(t.settings.roles).map((k) => [k, 0])) as Table["settings"]["roles"];
  t.settings.roles.werewolf = 1;
  expect(command(t, 1, { t: "start" }, clock, rand)).toEqual({ ok: true });
  t.players.forEach((p, i) => {
    p.role = roles[i] ?? "villager";
  });
  pass(t); // the deal is over: night 1
  expect(t.phase).toBe("night");
  return t;
}

const act = (t: Table, by: number, cmd: TableCommand) => command(t, by, cmd, clock, rand);
/** Lets the current phase run out. */
function pass(t: Table) {
  clock = (t.deadline ?? clock) + 1;
  tick(t, clock, rand);
}
const alive = (t: Table, id: number) => t.players.find((p) => p.id === id)!.alive;

describe("the lobby", () => {
  it("seats people up to the table's size and checks the roles fit", () => {
    const t = newTable("abc123", seat(1), clock, { ...defaultSettings(), seats: 5, roles: suggestRoles(5) });
    for (let i = 2; i <= 5; i++) expect(arrive(t, seat(i), clock)).toEqual({ ok: true });
    expect(arrive(t, seat(6), clock)).toEqual({ error: "this table is full" });
    expect(cannotStart(t.settings, 4)).toMatch(/at least 5/);
    expect(cannotStart({ ...t.settings, roles: { ...t.settings.roles, werewolf: 3 } }, 5)).toMatch(/too many wolves/);
    expect(act(t, 2, { t: "start" })).toEqual({ error: "only the host starts the game" });
    expect(act(t, 1, { t: "start" })).toEqual({ ok: true });
    expect(t.phase).toBe("deal");
    expect(t.players.filter((p) => p.role === "werewolf")).toHaveLength(1);
    expect(arrive(t, seat(9), clock)).toEqual({ error: "this game has already started" });
  });
});

describe("the night", () => {
  it("the wolves kill, unless the bodyguard or the witch saves the one they attacked", () => {
    const t = game(["werewolf", "bodyguard", "witch", "villager", "villager"]);
    // one role at a time: the Bodyguard first, while the wolves sleep
    expect(t.night.step).toBe("guard");
    expect(viewFor(t, 2, clock).step).toBe("guard");
    expect(act(t, 1, { t: "pick", ids: [4] })).toEqual({ error: "nothing to choose right now" });
    act(t, 2, { t: "pick", ids: [5] });
    // their turn is done: the clock skips to its last seconds, then the wolves wake
    expect(t.deadline).toBe(clock + LAST_MS);
    pass(t);
    expect(t.night.step).toBe("wolves");
    expect(act(t, 2, { t: "pick", ids: [4] })).toEqual({ error: "nothing to choose right now" });
    expect(act(t, 1, { t: "pick", ids: [4] })).toEqual({ ok: true });
    expect(act(t, 1, { t: "pick", ids: [1] })).toEqual({ error: "pick someone at the table" });
    expect(t.deadline).toBe(clock + LAST_MS);
    pass(t);
    expect(t.phase).toBe("witch");
    expect(viewFor(t, 3, clock).witch?.attacked).toEqual([4]);
    expect(viewFor(t, 4, clock).witch).toBeNull();
    act(t, 3, { t: "witch", heal: null, poison: null });
    expect(t.phase).toBe("witch");
    pass(t);
    expect(t.phase).toBe("dawn");
    expect(alive(t, 4)).toBe(false);

    pass(t); // dawn → discussion
    expect(t.phase).toBe("discussion");
    pass(t);
    pass(t); // nobody voted
    pass(t); // verdict → night 2
    expect(t.phase).toBe("night");
    expect(act(t, 2, { t: "pick", ids: [5] })).toEqual({ error: "pick someone at the table" }); // guarded 5 last night
    act(t, 2, { t: "pick", ids: [3] });
    pass(t);
    act(t, 1, { t: "pick", ids: [5] });
    pass(t);
    act(t, 3, { t: "witch", heal: 5, poison: null });
    pass(t);
    expect(alive(t, 5)).toBe(true);
    expect(t.log.some((l) => l.text.startsWith("Nobody died last night: the wolves came"))).toBe(true);
    // the Witch sees her potion on the house, and is told; the one she saved learns someone did
    expect(viewFor(t, 3, clock).signs).toEqual([{ id: 5, sign: "heal" }]);
    expect(viewFor(t, 3, clock).notes.at(-1)?.text).toBe("Night 2: your potion saved P5.");
    expect(viewFor(t, 5, clock).notes.at(-1)?.text).toMatch(/someone brought you back/);
    expect(viewFor(t, 2, clock).signs).toEqual([]);
  });

  it("the Bodyguard sees their watch hold; the village sees how each one died", () => {
    const t = game(["werewolf", "bodyguard", "witch", "villager", "villager", "villager"]);
    act(t, 2, { t: "pick", ids: [4] });
    pass(t);
    act(t, 1, { t: "pick", ids: [4] });
    pass(t);
    act(t, 3, { t: "witch", heal: null, poison: 6 });
    pass(t);
    expect(alive(t, 4)).toBe(true);
    expect(alive(t, 6)).toBe(false);
    expect(viewFor(t, 2, clock).signs).toEqual([{ id: 4, sign: "shield" }]);
    expect(viewFor(t, 2, clock).notes.at(-1)?.text).toMatch(/your watch sent them away/);
    expect(viewFor(t, 3, clock).signs).toEqual([{ id: 6, sign: "poison" }]);
    expect(viewFor(t, 5, clock).signs).toEqual([]);
    expect(viewFor(t, 5, clock).players[5]!.cause).toBe("poison");
    expect(t.log.some((l) => l.text.includes("was found dead, poisoned"))).toBe(true);
    expect(t.log.some((l) => l.text === "And someone the wolves came for was kept safe.")).toBe(true);
    // the signs go when night falls again
    while (t.phase !== "night") pass(t);
    expect(viewFor(t, 2, clock).signs).toEqual([]);
  });

  it("tells the seer what they saw, and only them", () => {
    const t = game(["werewolf", "seer", "cursed", "witch", "villager"]);
    expect(t.night.step).toBe("seer");
    act(t, 2, { t: "pick", ids: [4] });
    expect(viewFor(t, 2, clock).notes.at(-1)?.text).toBe("Night 1: P4 is the Witch.");
    expect(act(t, 2, { t: "pick", ids: [3] })).toEqual({ error: "you've already chosen" });
    // the Seer sees the role on the house; nobody else does
    const seer = viewFor(t, 2, clock).players[3]!;
    expect([seer.role, seer.seen]).toEqual(["witch", true]);
    expect(viewFor(t, 5, clock).players[3]!.role).toBeNull();
    expect(viewFor(t, 5, clock).notes.some((n) => n.text.includes("Witch."))).toBe(false);
    // a Cursed player looks like a villager
    pass(t);
    pass(t); // the wolves' turn runs out
    pass(t); // the witch's
    while (t.phase !== "night") pass(t);
    act(t, 2, { t: "pick", ids: [3] });
    expect(viewFor(t, 2, clock).notes.at(-1)?.text).toBe("Night 2: P3 is a Villager.");
  });

  it("the elder survives the first bite and the cursed joins the pack", () => {
    const t = game(["werewolf", "elder", "cursed", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [2] });
    pass(t);
    expect(t.phase).toBe("dawn");
    expect(alive(t, 2)).toBe(true);
    pass(t);
    pass(t);
    pass(t);
    pass(t);
    act(t, 1, { t: "pick", ids: [3] });
    pass(t);
    expect(alive(t, 3)).toBe(true);
    expect(t.players[2]!.role).toBe("werewolf");
    expect(viewFor(t, 1, clock).players[2]!.role).toBe("werewolf");
  });
});

describe("deaths that bring more deaths", () => {
  it("the hunter shoots, and a lover follows the other", () => {
    const t = game(["werewolf", "cupid", "hunter", "villager", "villager", "villager", "villager"]);
    expect(t.night.step).toBe("cupid");
    act(t, 2, { t: "pick", ids: [3, 4] });
    pass(t);
    // the arrow lands when Cupid's turn ends
    expect(t.lovers).toEqual([3, 4]);
    expect(viewFor(t, 4, clock).notes.at(-1)?.text).toMatch(/you love P3/);
    act(t, 1, { t: "pick", ids: [3] });
    pass(t);
    expect(alive(t, 3)).toBe(false);
    expect(alive(t, 4)).toBe(false); // grief
    pass(t); // dawn → the hunter's turn
    expect(t.phase).toBe("hunter");
    expect(viewFor(t, 3, clock).ask?.kind).toBe("hunter");
    act(t, 3, { t: "pick", ids: [1] });
    expect(alive(t, 1)).toBe(false);
    expect(viewFor(t, 5, clock).players.map((p) => p.cause)).toEqual([
      "hunter",
      null,
      "wolves",
      "grief",
      null,
      null,
      null,
    ]);
    expect(t.phase).toBe("over");
    expect(t.winner?.team).toBe("village");
  });

  it("the hunter shoots when the village votes them out, or the witch poisons them", () => {
    const t = game(["werewolf", "hunter", "witch", "villager", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [7] });
    pass(t);
    act(t, 3, { t: "witch", heal: null, poison: 2 });
    pass(t);
    expect(alive(t, 2)).toBe(false);
    pass(t); // dawn → the hunter's turn
    expect(t.phase).toBe("hunter");
    act(t, 2, { t: "pick", ids: [4] });
    expect(alive(t, 4)).toBe(false);

    const u = game(["werewolf", "hunter", "villager", "villager", "villager", "villager", "villager"]);
    act(u, 1, { t: "pick", ids: [7] });
    pass(u);
    pass(u);
    pass(u); // discussion over
    for (const id of [1, 3, 4]) act(u, id, { t: "pick", ids: [2] });
    pass(u);
    expect(alive(u, 2)).toBe(false);
    pass(u); // verdict → the hunter's turn
    expect(u.phase).toBe("hunter");
    expect(viewFor(u, 2, clock).ask?.kind).toBe("hunter");
    act(u, 2, { t: "pick", ids: [1] });
    expect(u.winner?.team).toBe("village");
  });
});

describe("the day", () => {
  it("votes someone out by plurality; a tie sends nobody", () => {
    const t = game(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [6] });
    pass(t);
    pass(t);
    for (const id of [1, 2, 3, 4]) act(t, id, { t: "ready", ready: true });
    expect(t.phase).toBe("vote");
    act(t, 1, { t: "pick", ids: [2] });
    act(t, 2, { t: "pick", ids: [1] });
    act(t, 3, { t: "pick", ids: [1] });
    act(t, 4, { t: "pick", ids: [2] });
    expect(viewFor(t, 5, clock).votes).toEqual({ "1": 2, "2": 1, "3": 1, "4": 2 });
    act(t, 5, { t: "pick", ids: [0] });
    // everyone has voted: a few seconds to change their minds, then the verdict
    expect(t.phase).toBe("vote");
    pass(t);
    expect(t.phase).toBe("verdict");
    // everyone sees how the village voted, "nobody" too; with no sheriff, a tie sends nobody
    expect(t.log.at(-2)?.text).toBe("The votes: P2 2, P1 2, nobody 1.");
    expect(t.log.at(-1)?.text).toBe("A tie, and no sheriff to settle it. Nobody leaves today.");
  });

  it("the village idiot survives one vote; the tanner wins by being voted out", () => {
    const t = game(["werewolf", "idiot", "tanner", "villager", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [7] });
    pass(t);
    pass(t);
    pass(t); // discussion over
    for (const id of [1, 3, 4, 5]) act(t, id, { t: "pick", ids: [2] });
    pass(t);
    expect(alive(t, 2)).toBe(true);
    expect(t.players[1]!.canVote).toBe(false);
    expect(viewFor(t, 4, clock).players[1]!.role).toBe("idiot");
    pass(t); // verdict → night 2
    act(t, 1, { t: "pick", ids: [6] });
    pass(t);
    pass(t);
    pass(t);
    for (const id of [1, 4, 5]) act(t, id, { t: "pick", ids: [3] });
    pass(t);
    expect(t.winner).toEqual({ team: "tanner", ids: [3] });
  });

  it("the wolves win when there are as many of them as everyone else", () => {
    const t = game(["werewolf", "werewolf", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [3] });
    act(t, 2, { t: "pick", ids: [3] });
    pass(t);
    expect(t.phase).toBe("dawn");
    pass(t);
    expect(t.phase).toBe("over");
    expect(t.winner?.team).toBe("wolves");
    expect(viewFor(t, 3, clock).players.every((p) => p.role !== null)).toBe(true);
  });

  it("elects a sheriff whose vote counts twice", () => {
    const t = game(["werewolf", "villager", "villager", "villager", "villager", "villager"], { sheriff: true });
    act(t, 1, { t: "pick", ids: [6] });
    pass(t);
    pass(t);
    expect(t.phase).toBe("election");
    for (const id of [1, 2, 3, 4, 5]) act(t, id, { t: "pick", ids: [2] });
    pass(t);
    expect(t.sheriff).toBe(2);
    pass(t);
    act(t, 2, { t: "pick", ids: [1] });
    act(t, 3, { t: "pick", ids: [4] });
    act(t, 4, { t: "pick", ids: [3] });
    act(t, 1, { t: "pick", ids: [0] });
    act(t, 5, { t: "pick", ids: [0] });
    // 1 has the sheriff's two votes, 4 and 3 one each, "nobody" two: still a tie at the top, so nobody leaves
    expect(alive(t, 1)).toBe(true);
  });

  it("lets the sheriff choose who leaves when two players are tied", () => {
    const t = game(["werewolf", "villager", "villager", "villager", "villager", "villager", "villager"], {
      sheriff: true,
    });
    act(t, 1, { t: "pick", ids: [7] });
    pass(t);
    pass(t);
    for (const id of [1, 2, 3, 4, 5, 6]) act(t, id, { t: "pick", ids: [2] });
    pass(t);
    expect(t.sheriff).toBe(2);
    pass(t);
    // 3 gets 1 + 1 + 1, 4 gets the sheriff's 2 + 1: a tie at three, and the sheriff chooses
    for (const id of [1, 5, 6]) act(t, id, { t: "pick", ids: [3] });
    act(t, 2, { t: "pick", ids: [4] });
    act(t, 3, { t: "pick", ids: [4] });
    pass(t);
    expect(t.phase).toBe("tiebreak");
    expect(t.log.at(-1)?.text).toBe("A tie between P3 and P4. The sheriff, P2, decides who leaves.");
    expect(viewFor(t, 3, clock).ask).toBeNull();
    expect(viewFor(t, 2, clock).ask).toMatchObject({ kind: "tiebreak", choices: [3, 4] });
    expect(act(t, 2, { t: "pick", ids: [5] })).toEqual({ error: "pick someone at the table" });
    act(t, 2, { t: "pick", ids: [3] });
    expect(alive(t, 3)).toBe(false);
    expect(alive(t, 4)).toBe(true);
    expect(t.phase).toBe("verdict");
  });

  it("a sheriff who doesn't choose sends nobody", () => {
    const t = game(["werewolf", "villager", "villager", "villager", "villager", "villager", "villager"], {
      sheriff: true,
    });
    act(t, 1, { t: "pick", ids: [7] });
    pass(t);
    pass(t);
    for (const id of [1, 2, 3, 4, 5, 6]) act(t, id, { t: "pick", ids: [2] });
    pass(t);
    pass(t);
    for (const id of [1, 5]) act(t, id, { t: "pick", ids: [3] });
    for (const id of [3, 6]) act(t, id, { t: "pick", ids: [4] });
    pass(t);
    expect(t.phase).toBe("tiebreak");
    pass(t);
    expect(t.phase).toBe("verdict");
    expect([alive(t, 3), alive(t, 4)]).toEqual([true, true]);
  });
});

describe("what each player may know, see and hear", () => {
  it("keeps roles secret, shows the pack to the wolves, and keeps the night's voices among them", () => {
    const t = game(["werewolf", "werewolf", "seer", "villager", "villager", "villager", "villager"]);
    const villager = viewFor(t, 4, clock);
    expect(villager.players.filter((p) => p.role !== null).map((p) => p.id)).toEqual([4]);
    expect(villager.voice).toEqual({ speakTo: [], hear: [] });
    expect(villager.channel).toBeNull();
    expect(act(t, 4, { t: "chat", body: "hello?" })).toEqual({ error: "it's night: only the wolves can talk" });

    const wolf = viewFor(t, 1, clock);
    expect(wolf.players.filter((p) => p.role === "werewolf").map((p) => p.id)).toEqual([1, 2]);
    expect(wolf.voice).toEqual({ speakTo: [2], hear: [2] });
    act(t, 1, { t: "chat", body: "the quiet one" });
    expect(viewFor(t, 2, clock).chat.at(-1)?.body).toBe("the quiet one");
    expect(viewFor(t, 4, clock).chat).toHaveLength(0);

    act(t, 3, { t: "pick", ids: [4] });
    pass(t);
    act(t, 1, { t: "pick", ids: [7] });
    act(t, 2, { t: "pick", ids: [7] });
    pass(t);
    expect(t.phase).toBe("dawn");
    // by day everyone alive talks to everyone; the dead only to the dead, but hear the living
    expect(viewFor(t, 4, clock).voice.speakTo).toEqual([1, 2, 3, 5, 6, 7]);
    expect(viewFor(t, 7, clock).voice).toEqual({ speakTo: [], hear: [1, 2, 3, 4, 5, 6] });
    // the dead see no more roles than they did alive (reveal is on: their own, and the dead's)
    expect(
      viewFor(t, 7, clock)
        .players.filter((p) => p.role !== null)
        .map((p) => p.id),
    ).toEqual([7]);
    // the dead don't read the pack, and the living don't read the dead
    expect(viewFor(t, 7, clock).chat.some((c) => c.channel === "wolves")).toBe(false);
    act(t, 7, { t: "chat", body: "it was P1" });
    expect(t.chat.at(-1)?.channel).toBe("dead");
    expect(viewFor(t, 4, clock).chat.some((c) => c.channel === "dead")).toBe(false);
    // by day the wolves have their own channel too, which only they read
    expect(viewFor(t, 1, clock).channels).toEqual(["all", "wolves"]);
    expect(viewFor(t, 4, clock).channels).toEqual(["all"]);
    act(t, 1, { t: "chat", body: "vote the seer", channel: "wolves" });
    expect(t.chat.at(-1)?.channel).toBe("wolves");
    expect(viewFor(t, 2, clock).chat.at(-1)?.body).toBe("vote the seer");
    expect(viewFor(t, 4, clock).chat.some((c) => c.body === "vote the seer")).toBe(false);
    act(t, 4, { t: "chat", body: "sneaky", channel: "wolves" });
    expect(t.chat.at(-1)?.channel).toBe("all");
    // the next night, the dead hear nobody but the dead: not the wolves
    while (t.phase !== "night") pass(t);
    expect(viewFor(t, 7, clock).voice.hear).toEqual([]);
  });

  it("computer players sit down, play a whole game on their own, and never become the host", () => {
    let seed = 7;
    const chance = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const t = newTable("bots01", seat(1), clock, { ...defaultSettings(), seats: 8 });
    expect(command(t, 2, { t: "bot", add: true }, clock, chance)).toEqual({ error: "you're not at this table" });
    for (let i = 0; i < 6; i++) expect(command(t, 1, { t: "bot", add: true }, clock, chance)).toEqual({ ok: true });
    expect(t.players.filter((p) => p.bot).map((p) => p.name)).toEqual(["Owl", "Moth", "Fox", "Crow", "Hare", "Badger"]);
    expect(viewFor(t, 1, clock).players.find((p) => p.id === BOT_BASE)?.bot).toBe(true);
    expect(command(t, 1, { t: "bot", add: false }, clock, chance)).toEqual({ ok: true });
    expect(t.players).toHaveLength(6);
    expect(command(t, 1, { t: "start" }, clock, chance)).toEqual({ ok: true });
    // the one person plays like the computer players, so the whole game runs here
    t.players[0]!.bot = true;
    let now = clock;
    for (let step = 0; step < 400 && t.phase !== "over"; step++) {
      const moves = botMoves(t, chance);
      for (const { id, cmd } of moves) command(t, id, cmd, now, chance);
      if (!moves.length) {
        now = (t.deadline ?? now) + 1;
        tick(t, now, chance);
      }
    }
    expect(t.phase).toBe("over");
    expect(t.winner).not.toBeNull();
    // the person leaves: a computer player is never handed the table
    t.players[0]!.bot = false;
    command(t, 1, { t: "leave" }, now, chance);
    expect(t.players.some((p) => p.id === t.host)).toBe(false);
  });

  it("the host asks someone to leave (they may come back) or not to come back (they may not)", () => {
    const t = newTable("kick01", seat(1), clock);
    arrive(t, seat(2), clock);
    arrive(t, seat(3), clock);
    expect(act(t, 2, { t: "kick", id: 3 })).toEqual({ error: "you can't do that" });
    expect(act(t, 1, { t: "kick", id: 2 })).toEqual({ ok: true });
    expect(arrive(t, seat(2), clock)).toEqual({ ok: true });
    expect(act(t, 1, { t: "kick", id: 3, ban: true })).toEqual({ ok: true });
    expect(arrive(t, seat(3), clock)).toEqual({ error: TABLE_BANNED });
    expect(t.players.map((p) => p.id)).toEqual([1, 2]);
  });
});
