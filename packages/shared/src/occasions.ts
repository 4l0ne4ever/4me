import { z } from "zod";
import { NIGHT, nightOf, promptFor } from "./nights";

// The nights that are not like the others. Most nights are ordinary, and nothing is announced on them; a few a month
// come from the calendar by themselves (the full moon, Mid-Autumn, the last night of the lunar year, Halloween, the
// longest night), and now and then the moderator hosts one (a night shift, a question of their own).

export type OccasionKey = "newyear" | "midautumn" | "halloween" | "solstice" | "fullmoon";

/** A night the calendar makes special: what to call it, a line about it, its own question and its poem's title. */
export type Occasion = { key: OccasionKey; title: string; line: string; question: string; poem: string };

const OCCASIONS: Record<OccasionKey, Omit<Occasion, "key">> = {
  newyear: {
    title: "The last night of the year",
    line: "Giao thừa. The poem stays open across midnight, into the new year.",
    question: "What are you leaving in this year?",
    poem: "The poem across the new year",
  },
  midautumn: {
    title: "Mid-Autumn",
    line: "Tết Trung thu: the year's roundest moon, and star lanterns over the roofs.",
    question: "Who would you share a mooncake with tonight?",
    poem: "The Mid-Autumn poem",
  },
  halloween: {
    title: "Halloween",
    line: "The bats are out. Write down what still scares you, and leave the light on.",
    question: "What still scares you, a little?",
    poem: "The Halloween poem",
  },
  solstice: {
    title: "The longest night",
    line: "The winter solstice: more dark tonight than on any other night of the year.",
    question: "What keeps you company on long nights?",
    poem: "The longest night's poem",
  },
  fullmoon: {
    title: "Full moon",
    line: "Rằm. The moon is full tonight; look up once before you write.",
    question: "What would you tell the moon tonight?",
    poem: "The full moon's poem",
  },
};

/** Mid-Autumn (Tết Trung thu), the 15th of the eighth lunar month. */
export const MID_AUTUMN = ["2025-10-06", "2026-09-25", "2027-09-15", "2028-10-03", "2029-09-22", "2030-09-12"];
/** The first day of the lunar new year (Tết Nguyên Đán); its eve is the night before. */
export const TET = ["2025-01-29", "2026-02-17", "2027-02-06", "2028-01-26", "2029-02-13", "2030-02-03", "2031-01-23"];

const DAY = 86_400_000;
const shift = (night: string, days: number) =>
  new Date(Date.parse(`${night}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * The moment of the full moon nearest to `at`, to within a few minutes (Meeus, Astronomical Algorithms, ch. 49,
 * with the main periodic terms).
 */
export function fullMoonNear(at: Date): Date {
  const jd = at.getTime() / DAY + 2440587.5;
  const k = Math.round((jd - 2451550.09766) / 29.530588861 - 0.5) + 0.5;
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = rad(2.5534 + 29.1053567 * k - 0.0000014 * T * T);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T * T);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T * T);
  const O = rad(124.7746 - 1.56375588 * k + 0.0020672 * T * T);
  const jde =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * T * T -
    0.4061 * Math.sin(Mp) +
    0.17302 * E * Math.sin(M) +
    0.01614 * Math.sin(2 * Mp) +
    0.01043 * Math.sin(2 * F) +
    0.00734 * E * Math.sin(Mp - M) -
    0.00514 * E * Math.sin(Mp + M) +
    0.00209 * E * E * Math.sin(2 * M) -
    0.00111 * Math.sin(Mp - 2 * F) -
    0.00057 * Math.sin(Mp + 2 * F) +
    0.00056 * E * Math.sin(2 * Mp + M) -
    0.00042 * Math.sin(3 * Mp) +
    0.00042 * E * Math.sin(M + 2 * F) +
    0.00038 * E * Math.sin(M - 2 * F) -
    0.00024 * E * Math.sin(2 * Mp - M) -
    0.00017 * Math.sin(O);
  return new Date((jde - 2440587.5) * DAY);
}

/** True on the night the moon is full: the night its fullest moment falls in. */
export function isFullMoon(night: string): boolean {
  return nightOf(fullMoonNear(new Date(`${night}T23:00:00+07:00`))) === night;
}

/** What the calendar makes of this night, if anything. */
export function occasionOf(night: string): Occasion | null {
  const key: OccasionKey | null = TET.some((t) => shift(t, -1) === night)
    ? "newyear"
    : MID_AUTUMN.includes(night)
      ? "midautumn"
      : night.slice(5) === "10-31"
        ? "halloween"
        : night.slice(5) === "12-21"
          ? "solstice"
          : isFullMoon(night)
            ? "fullmoon"
            : null;
  return key ? { key, ...OCCASIONS[key] } : null;
}

/** A night the moderator hosts: a line on the desktop, perhaps its own question, perhaps a night shift. */
export type NightEvent = {
  id: number;
  night: string;
  title: string;
  body: string;
  /** Replaces the night's question. */
  question: string | null;
  /** When a time is given; with `shift`, everyone writes together until `endsAt`, and the pages open together. */
  startsAt: string | null;
  endsAt: string | null;
  shift: boolean;
};

/** What a night holds: the moderator's event for it, and the next night's, to say "tomorrow night". */
export type NightPlan = { night: string; event: NightEvent | null; next: NightEvent | null };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const nightEventInput = z
  .object({
    night: z.string().regex(NIGHT, "pick a date"),
    title: z.string().trim().min(2, "give it a name").max(60),
    body: z.string().trim().max(160).default(""),
    question: z
      .string()
      .trim()
      .max(160)
      .transform((v) => v || null)
      .nullable()
      .default(null),
    /** "23:00"; before 06:00 means after midnight, still the same night. */
    start: z
      .string()
      .trim()
      .regex(HHMM, "a time like 23:00")
      .or(z.literal(""))
      .transform((v) => v || null)
      .nullable()
      .default(null),
    minutes: z.coerce.number().int().min(10).max(240).default(45),
    shift: z.boolean().default(false),
  })
  .refine((v) => !v.shift || v.start, { message: "a night shift needs a start time", path: ["start"] });
export type NightEventInput = z.input<typeof nightEventInput>;

/** The moment a time of the night falls at: 23:00 is that evening, 01:30 the small hours after it. */
export function nightTime(night: string, hhmm: string): Date {
  const date = Number(hhmm.slice(0, 2)) < 6 ? shift(night, 1) : night;
  return new Date(`${date}T${hhmm}:00+07:00`);
}

/** The night's question: the moderator's, else the calendar's, else the one the rotation gives. */
export function questionFor(night: string, event?: NightEvent | null): string {
  return event?.question ?? occasionOf(night)?.question ?? promptFor(night);
}
