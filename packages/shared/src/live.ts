import type { EntrySummary, Note, Reactions, Shout } from "./schemas";

// What travels over the live connection. Topics a browser can listen to:
//   entry:<id>      notes, BUZZes and how many are reading one page
//   guest:<handle>  a member's guestbook ("guest:_" is the shared one on the front page)
//   tonight         new public pages, for the Tonight window
//   user:<id>       one member's notifications; only with a ticket the web server signed for them

export type NotificationKind = "note" | "pending" | "reply" | "shout" | "buzz" | "reaction" | "post" | "opened";

export type Notification = {
  id: number;
  kind: NotificationKind;
  /** One line, ready to show: "Lan left a note on “The last tram”". */
  text: string;
  /** Where clicking it goes, a path on the site. */
  link: string;
  actor: { name: string; avatar: string } | null;
  createdAt: string;
  read: boolean;
};

export type LiveEvent =
  | { type: "hello" }
  | { type: "note"; entryId: number; note: Note }
  | { type: "note-gone"; entryId: number; noteId: number }
  | { type: "reactions"; entryId: number; target: "entry" | "note"; targetId: number; reactions: Reactions }
  | { type: "shout"; owner: string | null; shout: Shout }
  | { type: "buzz"; entryId: number }
  | { type: "presence"; entryId: number; reading: number }
  /** How many people have 4me open right now: the lit windows on the skyline. */
  | { type: "awake"; n: number }
  | { type: "entry"; entry: EntrySummary }
  | { type: "notify"; notification: Notification };

export const PUBLIC_TOPIC = /^(entry:\d{1,10}|guest:(_|[a-z0-9][a-z0-9_]{1,19})|tonight)$/;
export const MAX_TOPICS = 6;
