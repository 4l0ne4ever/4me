// Ink's needs, kept per visitor. Pure functions so they are easy to test and tune.

export type Needs = { hunger: number; joy: number; at: number };
export type Mood = "content" | "hungry" | "starving" | "lonely";

const HUNGER_PER_MIN = 0.5; // from full to empty in a little over three hours
const JOY_PER_MIN = 0.35;

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export const fresh = (now: number): Needs => ({ hunger: 80, joy: 70, at: now });

export function decay(n: Needs, now: number): Needs {
  const mins = Math.max(0, (now - n.at) / 60000);
  return { hunger: clamp(n.hunger - mins * HUNGER_PER_MIN), joy: clamp(n.joy - mins * JOY_PER_MIN), at: now };
}

export const feed = (n: Needs, amount = 40): Needs => ({ ...n, hunger: clamp(n.hunger + amount) });
export const pet = (n: Needs, amount = 6): Needs => ({ ...n, joy: clamp(n.joy + amount) });
export const play = (n: Needs, amount = 15): Needs => ({
  ...n,
  joy: clamp(n.joy + amount),
  hunger: clamp(n.hunger - 4),
});

export const isFull = (n: Needs) => n.hunger >= 92;

export function moodOf(n: Needs): Mood {
  if (n.hunger < 15) return "starving";
  if (n.hunger < 35) return "hungry";
  if (n.joy < 30) return "lonely";
  return "content";
}

const LINES: Record<Mood, string[]> = {
  content: [
    "mrrp.",
    "she wrote about the rain again.",
    "leave a note, i get a fish.",
    "purrrr",
    "the bus never stops for her.",
    "try the bin icon. shh.",
    "start menu. skins. trust me.",
  ],
  hungry: ["...fish?", "the bowl is very empty.", "i would like one (1) fish."],
  starving: ["FISH.", "i am wasting away down here.", "right click me. feed me."],
  lonely: ["pet me?", "nobody has stroked me in ages.", "i'm right here, you know."],
};

export function lineFor(mood: Mood, roll: number): string {
  const list = LINES[mood];
  return list[Math.floor(roll * list.length) % list.length] ?? "mrrp.";
}

export function load(raw: string | null, now: number): Needs {
  if (!raw) return fresh(now);
  try {
    const v = JSON.parse(raw) as Partial<Needs>;
    if (typeof v.hunger !== "number" || typeof v.joy !== "number" || typeof v.at !== "number") return fresh(now);
    return decay({ hunger: v.hunger, joy: v.joy, at: Math.min(v.at, now) }, now);
  } catch {
    return fresh(now);
  }
}
