"use server";

import {
  type DiaryExport,
  type EntrySummary,
  editNoteInput,
  type InkState,
  inkState,
  type Me,
  type MyNote,
  type MyReactions,
  memberNoteInput,
  memberReactInput,
  memberShoutInput,
  type Note,
  password as passwordSchema,
  profileInput,
  type ReactionKind,
  type Reactions,
  reportReason,
  type Shout,
  type Subscription,
} from "@4me/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Fail, fail, type Ok, signedOut } from "./action-result";
import { endSession, getMe, internalApi, type MeWithVersion, publicMe, startSession } from "./auth";
import { hashPassword, verifyPassword } from "./crypto";

// Everything a signed-in reader can do. Each action re-reads the session itself; nothing trusts the browser's word.

/** A note on a page, or with `parentId` a reply to one of its notes. */
export async function noteAsMember(
  entryId: number,
  body: string,
  parentId?: number,
): Promise<Ok<{ note: Note; pending: boolean }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = memberNoteInput.safeParse({ body, parentId });
  if (!input.success || !Number.isInteger(entryId))
    return { ok: false, error: "write something first (500 characters at most)" };
  try {
    const res = await internalApi<{ note: Note; pending: boolean }>(`/users/${me.id}/notes/${entryId}`, {
      method: "POST",
      body: input.data,
    });
    return { ok: true, ...res };
  } catch (e) {
    return fail(e);
  }
}

/** The note's writer, or the page's writer, deletes a note (and its replies). */
export async function deleteNote(noteId: number): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/notes/${noteId}`, { method: "DELETE" });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Sets this member's reaction on a page or a note; `null` takes it back. */
export async function reactAsMember(
  target: "entry" | "note",
  targetId: number,
  kind: ReactionKind | null,
): Promise<Ok<{ reactions: Reactions }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = memberReactInput.safeParse({ target, targetId, kind });
  if (!input.success) return { ok: false, error: "that reaction isn't one of ours" };
  try {
    return {
      ok: true,
      ...(await internalApi<{ reactions: Reactions }>(`/users/${me.id}/react`, { method: "POST", body: input.data })),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function myReactions(entryId: number): Promise<MyReactions> {
  const me = await getMe();
  if (!me || !Number.isInteger(entryId)) return { entry: null, notes: {} };
  return internalApi<MyReactions>(`/users/${me.id}/reactions?entry=${entryId}`).catch(() => ({
    entry: null,
    notes: {},
  }));
}

/** The note's writer changes what it says. */
export async function editNote(noteId: number, body: string): Promise<Ok<{ note: Note; pending: boolean }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = editNoteInput.safeParse({ body });
  if (!input.success) return { ok: false, error: "write something (500 characters at most)" };
  try {
    return {
      ok: true,
      ...(await internalApi<{ note: Note; pending: boolean }>(`/users/${me.id}/notes/${noteId}`, {
        method: "PATCH",
        body: input.data,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function reportNoteAsMember(noteId: number, reason: string): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const parsed = reportReason.safeParse(reason);
  if (!parsed.success) return { ok: false, error: "pick a reason" };
  try {
    await internalApi(`/users/${me.id}/reports/notes/${noteId}`, { method: "POST", body: { reason: parsed.data } });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function mySubscriptions(): Promise<Subscription[]> {
  const me = await getMe();
  return me ? internalApi<Subscription[]>(`/users/${me.id}/subscriptions`).catch(() => []) : [];
}

/** Subscribes to a diary, or stops. */
export async function setSubscribed(handle: string, on: boolean): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/subscriptions/${encodeURIComponent(handle)}`, {
      method: on ? "POST" : "DELETE",
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Pages from the diaries this member subscribed to, newest first. */
export async function myFeed(): Promise<EntrySummary[]> {
  const me = await getMe();
  return me ? internalApi<EntrySummary[]>(`/users/${me.id}/feed`).catch(() => []) : [];
}

/** `owner` is the member whose guestbook it is; without it, the shared one on the front desktop. */
export async function shoutAsMember(
  body: string,
  owner: string,
): Promise<Ok<{ shout: Shout; pending: boolean }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = memberShoutInput.safeParse({ body, owner });
  if (!input.success) return { ok: false, error: "write something first (280 characters at most)" };
  try {
    return {
      ok: true,
      ...(await internalApi<{ shout: Shout; pending: boolean }>(`/users/${me.id}/shouts`, {
        method: "POST",
        body: input.data,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function saveInk(state: InkState): Promise<void> {
  const me = await getMe();
  const input = inkState.safeParse(state);
  if (!me || !input.success) return;
  await internalApi(`/users/${me.id}`, { method: "PATCH", body: { ink: input.data } }).catch(() => undefined);
}

export async function updateProfile(changes: {
  displayName?: string;
  avatar?: string;
  handle?: string;
  bio?: string;
  lastfmUser?: string;
}): Promise<Ok<{ me: Me }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = profileInput.safeParse(changes);
  if (!input.success) {
    const issue = input.error.issues[0];
    return { ok: false, error: issue?.message ?? "check the form", field: String(issue?.path[0] ?? "") };
  }
  try {
    const next = await internalApi<MeWithVersion>(`/users/${me.id}`, { method: "PATCH", body: input.data });
    // Their name, picture or address shows on their desktop and pages.
    revalidatePath(`/u/${me.handle}`, "layout");
    if (next.handle !== me.handle) revalidatePath(`/u/${next.handle}`, "layout");
    return { ok: true, me: publicMe(next) };
  } catch (e) {
    return fail(e);
  }
}

export async function myNotes(): Promise<MyNote[]> {
  const me = await getMe();
  if (!me) return [];
  return internalApi<MyNote[]>(`/users/${me.id}/notes`).catch(() => []);
}

/** Needs the current password when there is one. Every other device is signed out; this one stays in. */
export async function changePassword(current: string, next: string): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const pw = passwordSchema.safeParse(next);
  if (!pw.success) return { ok: false, error: pw.error.issues[0]?.message ?? "choose another password", field: "next" };
  if (me.hasPassword) {
    if (!me.email) return { ok: false, error: "this account has no email to check against" };
    try {
      const { user } = await internalApi<{ user: { passwordHash: string } | null }>("/sign-in", {
        method: "POST",
        body: { email: me.email },
      });
      if (!user || !(await verifyPassword(current, user.passwordHash))) {
        return { ok: false, error: "your current password isn't right", field: "current" };
      }
    } catch (e) {
      return fail(e);
    }
  }
  try {
    const { sessionVersion } = await internalApi<{ sessionVersion: number }>(`/users/${me.id}/password`, {
      method: "POST",
      body: { passwordHash: await hashPassword(pw.data) },
    });
    await startSession(me.id, sessionVersion);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signOutEverywhere(): Promise<void> {
  const me = await getMe();
  if (me) await internalApi(`/users/${me.id}/sign-out-everywhere`, { method: "POST" }).catch(() => undefined);
  await endSession();
  redirect("/welcome");
}

/** The reader types their own name to confirm. Their pages and photos go; their notes stay, signed "a former reader". */
export async function deleteAccount(confirmName: string): Promise<Fail | undefined> {
  const me = await getMe();
  if (!me) return signedOut;
  if (confirmName.trim().toLowerCase() !== me.displayName.toLowerCase()) {
    return { ok: false, error: "type your name exactly as it appears to confirm", field: "confirm" };
  }
  try {
    await internalApi(`/users/${me.id}`, { method: "DELETE" });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  await endSession();
  redirect("/?goodbye=1");
}

/** Everything the member wrote, for "Download my diary"; the browser fetches the photos and packs the zip. */
export async function exportDiary(): Promise<Ok<{ diary: DiaryExport }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    return { ok: true, diary: await internalApi<DiaryExport>(`/users/${me.id}/export`) };
  } catch (e) {
    return fail(e);
  }
}
