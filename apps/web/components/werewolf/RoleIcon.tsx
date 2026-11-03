import { ROLES, type RoleId } from "@4me/shared";

/** Role names short enough to sit under a house. */
export const ROLE_SHORT: Record<RoleId, string> = {
  villager: "Villager",
  werewolf: "Werewolf",
  wolfcub: "Wolf cub",
  seer: "Seer",
  bodyguard: "Bodyguard",
  witch: "Witch",
  hunter: "Hunter",
  cupid: "Cupid",
  elder: "Elder",
  idiot: "Idiot",
  cursed: "Cursed",
  tanner: "Tanner",
};

// One drawn mark per role, on a 16-unit grid in a single 1.4 stroke, like the desktop's own icons.
const PATHS: Record<RoleId, string> = {
  // a pitchfork
  villager: "M8 15V6 M4.5 2v3.2a3.5 3.5 0 0 0 7 0V2 M8 2v4",
  // a wolf's head: ears, muzzle
  werewolf: "M3 2.5 5.5 6h5L13 2.5V9l-2.5 4.5h-5L3 9z M6 8.6h.01 M10 8.6h.01 M7 11.3h2",
  // a paw
  wolfcub:
    "M8 9.5c-2.4 0-3.6 2-3.6 3.3 0 1 .9 1.4 1.8 1.2L8 13.5l1.8.5c.9.2 1.8-.2 1.8-1.2 0-1.3-1.2-3.3-3.6-3.3z M4 6.6a1.2 1.5 0 1 0 0 .1 M6.6 4.2a1.2 1.6 0 1 0 0 .1 M9.4 4.2a1.2 1.6 0 1 0 0 .1 M12 6.6a1.2 1.5 0 1 0 0 .1",
  // an eye
  seer: "M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  // a shield
  bodyguard: "M8 1.8 13 3.6v4c0 3.3-2.2 5.4-5 6.6-2.8-1.2-5-3.3-5-6.6v-4z M8 4.6v6.6",
  // a flask
  witch: "M6.2 1.8h3.6 M6.8 1.8v4.1L3.2 12.6c-.5 1 .2 1.8 1.2 1.8h7.2c1 0 1.7-.8 1.2-1.8L9.2 5.9V1.8 M4.8 10h6.4",
  // a crosshair
  hunter: "M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6z M8 1v3 M8 12v3 M1 8h3 M12 8h3",
  // a heart pierced by an arrow
  cupid:
    "M8 13.6S3 10.4 3 6.8A2.6 2.6 0 0 1 8 5.6a2.6 2.6 0 0 1 5 1.2c0 3.6-5 6.8-5 6.8z M1.6 12.4 14.4 3.6 M12 3.4h2.4v2.4",
  // a walking stick
  elder: "M9.6 14.6V5.4a2.4 2.4 0 0 0-4.8 0 M6 14.6h7",
  // a jester's cap
  idiot: "M3 12.6h10 M3.4 12.6 2 4.4l4 3.4L8 2.4l2 5.4 4-3.4-1.4 8.2 M2 4.4h.01 M8 2.4h.01 M14 4.4h.01",
  // a moon with a mark across it
  cursed: "M11.8 10.6A5.4 5.4 0 0 1 5.4 4.2a5.4 5.4 0 1 0 6.4 6.4z M10.2 2.2l3.6 3.6 M13.8 2.2l-3.6 3.6",
  // a knotted rope
  tanner: "M8 1.6v5.2 M5.6 9a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 0 0-4.8 0z M8 11.4v3",
};

export function RoleIcon({ of: role, className }: { of: RoleId; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`role-ic${className ? ` ${className}` : ""}`} aria-hidden="true">
      <path d={PATHS[role]} />
    </svg>
  );
}

export const teamOf = (r: RoleId) => ROLES[r].team;
