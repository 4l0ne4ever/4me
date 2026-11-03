import { describe, expect, it } from "vitest";
import {
  arrive,
  cannotStart,
  command,
  defaultSettings,
  newTable,
  type RoleId,
  suggestRoles,
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
    expect(act(t, 1, { t: "pick", ids: [4] })).toEqual({ ok: true });
    expect(act(t, 1, { t: "pick", ids: [1] })).toEqual({ error: "pick someone at the table" });
    act(t, 2, { t: "pick", ids: [5] });
    // everyone with something to do has done it: the witch's turn
    expect(t.phase).toBe("witch");
    expect(viewFor(t, 3, clock).witch?.attacked).toEqual([4]);
    expect(viewFor(t, 4, clock).witch).toBeNull();
    act(t, 3, { t: "witch", heal: null, poison: null });
    expect(t.phase).toBe("dawn");
    expect(alive(t, 4)).toBe(false);

    pass(t); // dawn → discussion
    expect(t.phase).toBe("discussion");
    pass(t);
    pass(t); // nobody voted
    pass(t); // verdict → night 2
    expect(t.phase).toBe("night");
    act(t, 1, { t: "pick", ids: [5] });
    expect(act(t, 2, { t: "pick", ids: [5] })).toEqual({ error: "pick someone at the table" }); // guarded 5 last night
    act(t, 2, { t: "pick", ids: [3] });
    act(t, 3, { t: "witch", heal: 5, poison: null });
    expect(alive(t, 5)).toBe(true);
    expect(t.log.some((l) => l.text === "Nobody died last night.")).toBe(true);
  });

  it("tells the seer what they saw, and only them", () => {
    const t = game(["werewolf", "seer", "villager", "villager", "villager"]);
    act(t, 2, { t: "pick", ids: [1] });
    expect(viewFor(t, 2, clock).notes.at(-1)?.text).toBe("Night 1: P1 IS a werewolf.");
    expect(act(t, 2, { t: "pick", ids: [3] })).toEqual({ error: "you've already chosen" });
    expect(viewFor(t, 3, clock).notes.some((n) => n.text.includes("werewolf."))).toBe(false);
  });

  it("the elder survives the first bite and the cursed joins the pack", () => {
    const t = game(["werewolf", "elder", "cursed", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [2] });
    expect(t.phase).toBe("dawn");
    expect(alive(t, 2)).toBe(true);
    pass(t);
    pass(t);
    pass(t);
    pass(t);
    act(t, 1, { t: "pick", ids: [3] });
    expect(alive(t, 3)).toBe(true);
    expect(t.players[2]!.role).toBe("werewolf");
    expect(viewFor(t, 1, clock).players[2]!.role).toBe("werewolf");
  });
});

describe("deaths that bring more deaths", () => {
  it("the hunter shoots, and a lover follows the other", () => {
    const t = game(["werewolf", "cupid", "hunter", "villager", "villager", "villager", "villager"]);
    act(t, 2, { t: "pick", ids: [3, 4] });
    act(t, 1, { t: "pick", ids: [3] });
    expect(t.lovers).toEqual([3, 4]);
    expect(viewFor(t, 4, clock).notes.at(-1)?.text).toMatch(/you love P3/);
    expect(alive(t, 3)).toBe(false);
    expect(alive(t, 4)).toBe(false); // grief
    pass(t); // dawn → the hunter's turn
    expect(t.phase).toBe("hunter");
    expect(viewFor(t, 3, clock).ask?.kind).toBe("hunter");
    act(t, 3, { t: "pick", ids: [1] });
    expect(alive(t, 1)).toBe(false);
    expect(t.phase).toBe("over");
    expect(t.winner?.team).toBe("village");
  });
});

describe("the day", () => {
  it("votes someone out by plurality; a tie sends nobody", () => {
    const t = game(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [6] });
    pass(t);
    for (const id of [1, 2, 3, 4]) act(t, id, { t: "ready", ready: true });
    expect(t.phase).toBe("vote");
    act(t, 1, { t: "pick", ids: [2] });
    act(t, 2, { t: "pick", ids: [1] });
    act(t, 3, { t: "pick", ids: [1] });
    act(t, 4, { t: "pick", ids: [2] });
    expect(viewFor(t, 5, clock).votes).toEqual({ "1": 2, "2": 1, "3": 1, "4": 2 });
    act(t, 5, { t: "pick", ids: [0] });
    expect(t.phase).toBe("verdict");
    expect(t.log.at(-1)?.text).toBe("No majority. Nobody leaves today.");
  });

  it("the village idiot survives one vote; the tanner wins by being voted out", () => {
    const t = game(["werewolf", "idiot", "tanner", "villager", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [7] });
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
    for (const id of [1, 4, 5]) act(t, id, { t: "pick", ids: [3] });
    pass(t);
    expect(t.winner).toEqual({ team: "tanner", ids: [3] });
  });

  it("the wolves win when there are as many of them as everyone else", () => {
    const t = game(["werewolf", "werewolf", "villager", "villager", "villager"]);
    act(t, 1, { t: "pick", ids: [3] });
    act(t, 2, { t: "pick", ids: [3] });
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
    expect(t.phase).toBe("election");
    for (const id of [1, 2, 3, 4, 5]) act(t, id, { t: "pick", ids: [2] });
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

    act(t, 1, { t: "pick", ids: [7] });
    act(t, 2, { t: "pick", ids: [7] });
    act(t, 3, { t: "pick", ids: [4] });
    expect(t.phase).toBe("dawn");
    // by day everyone alive talks to everyone; the dead only to the dead, but hear the living
    expect(viewFor(t, 4, clock).voice.speakTo).toEqual([1, 2, 3, 5, 6, 7]);
    expect(viewFor(t, 7, clock).voice).toEqual({ speakTo: [], hear: [1, 2, 3, 4, 5, 6] });
  });
});
