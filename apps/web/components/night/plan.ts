import { type NightEvent, type NightPlan, questionFor } from "@4me/shared";
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

/** Where a night shift stands: not yet, under way, or over (its pages open). */
export type ShiftPhase = "before" | "during" | "after";

export function shiftPhase(ev: NightEvent | null | undefined, now: number): ShiftPhase | null {
  if (!ev?.shift || !ev.startsAt || !ev.endsAt) return null;
  if (now < Date.parse(ev.startsAt)) return "before";
  return now < Date.parse(ev.endsAt) ? "during" : "after";
}

/** "1 h 20 min", "12 min", "under a minute": how long until a moment. */
export function until(iso: string, now: number): string {
  const min = Math.ceil((Date.parse(iso) - now) / 60_000);
  if (min <= 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

const plans = new Map<string, Promise<NightPlan | null>>();

/** A night's plan, fetched once per page load. */
export function loadPlan(night: string, fresh = false): Promise<NightPlan | null> {
  if (fresh || !plans.has(night))
    plans.set(
      night,
      fetch(`${API_URL}/nights/${night}/plan`, fresh ? { cache: "no-store" } : undefined)
        .then((r) => (r.ok ? (r.json() as Promise<NightPlan>) : null))
        .catch(() => null),
    );
  return plans.get(night)!;
}

/** The question a night asked (the moderator's, the calendar's, or the rotation's), for a page that answered it. */
export function useNightQuestion(night: string | null): string | null {
  const [event, setEvent] = useState<NightEvent | null>(null);
  useEffect(() => {
    if (!night) return;
    let live = true;
    void loadPlan(night).then((p) => live && setEvent(p?.event ?? null));
    return () => {
      live = false;
    };
  }, [night]);
  return night ? questionFor(night, event) : null;
}
