import { MID_AUTUMN } from "@4me/shared";
import { seasonalOutfit } from "../ink/looks";

/** What drifts across the desktop, by the date in Vietnam: the same calendar as Ink's hats. */
export type Fx = "mai" | "lanterns" | "bats" | "snow" | "drizzle" | "petals" | "fireflies" | "leaves";

const DAY = 86_400_000;

export function seasonFx(now: Date): Fx {
  const today = Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now));
  if (MID_AUTUMN.some((d) => Math.abs(today - Date.parse(d)) <= 4 * DAY)) return "lanterns";
  const hat = seasonalOutfit(now);
  if (hat === "mai") return "mai";
  if (hat === "witch") return "bats";
  if (hat === "santa") return "snow";
  // Hà Nội's winter is a fine, sideways drizzle, not snow.
  if (hat === "beanie") return "drizzle";
  if (hat === "flowers") return "petals";
  if (hat === "straw") return "fireflies";
  return "leaves";
}
