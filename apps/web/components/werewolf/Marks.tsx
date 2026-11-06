import type { Cause, Sign } from "@4me/shared";

// What the night leaves on the houses: how each of the dead died (everyone sees it), and what a player's own power did
// last night (only they see it): the Bodyguard's shield, the Witch's potion or poison, the Elder's fight.

export const CAUSE_TEXT: Record<Cause, string> = {
  wolves: "torn apart by wolves",
  poison: "poisoned",
  vote: "voted out",
  hunter: "shot by the Hunter",
  grief: "died of a broken heart",
};

export const SIGN_TEXT: Record<Sign["sign"], string> = {
  shield: "You kept them safe",
  heal: "Your potion saved them",
  poison: "Your poison took them",
  fought: "You fought them off",
};
/** The same, for a small window. */
export const SIGN_SHORT: Record<Sign["sign"], string> = {
  shield: "Kept safe",
  heal: "Saved",
  poison: "Poisoned",
  fought: "Fought off",
};

const CAUSE_PATH: Record<Cause, string> = {
  // three claw marks
  wolves: "M3.5 2.5l4 11M7 2l3.5 11.5M10.5 2.5l2.5 9",
  // a flask
  poison: "M6 1.5h4M6.6 1.5v4.2L3 12.6a1.2 1.2 0 0 0 1.1 1.9h7.8a1.2 1.2 0 0 0 1.1-1.9L9.4 5.7V1.5M4.6 10h6.8",
  // the gavel
  vote: "M2.5 14h6M9 2l5 5M6.5 4.5l5 5M8.75 6.25L3.5 11.5",
  // the sights
  hunter: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M8 1v4M8 11v4M1 8h4M11 8h4",
  // a heart, broken
  grief: "M8 14S2 10.2 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4.2-6 8-6 8M8 5l-1 3 2 1.5L8 12",
};

const SIGN_PATH: Record<Sign["sign"], string> = {
  shield: "M8 1.5l5.5 2v4.2c0 3.3-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.5-5.5-6.8V3.5zM5.5 8l1.8 1.8L10.8 6",
  heal: "M6 1.5h4M6.6 1.5v4.2L3 12.6a1.2 1.2 0 0 0 1.1 1.9h7.8a1.2 1.2 0 0 0 1.1-1.9L9.4 5.7V1.5M8 8.5v4M6 10.5h4",
  poison:
    "M6 1.5h4M6.6 1.5v4.2L3 12.6a1.2 1.2 0 0 0 1.1 1.9h7.8a1.2 1.2 0 0 0 1.1-1.9L9.4 5.7V1.5M6.2 9.2l3.6 3.6M9.8 9.2l-3.6 3.6",
  fought: "M8 1.5l5.5 2v4.2c0 3.3-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.5-5.5-6.8V3.5zM8 4.5v5M8 11.5v.5",
};

export function CauseIcon({ of, className = "" }: { of: Cause; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`ww-mark ${className}`} aria-hidden="true">
      <path d={CAUSE_PATH[of]} />
    </svg>
  );
}

export function SignIcon({ of, className = "" }: { of: Sign["sign"]; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`ww-mark ${className}`} aria-hidden="true">
      <path d={SIGN_PATH[of]} />
    </svg>
  );
}
