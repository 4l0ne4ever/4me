"use server";

import {
  type InkState,
  inkState,
  type Me,
  type MyNote,
  memberNoteInput,
  memberShoutInput,
  type Note,
  password as passwordSchema,
  profileInput,
  type Shout,
} from "@4me/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type Fail, fail, type Ok, signedOut } from "./action-result";
import { endSession, getMe, internalApi, type MeWithVersion, publicMe, startSession } from "./auth";
import { hashPassword, verifyPassword } from "./crypto";

// Everything a signed-in reader can do. Each action re-reads the session itself; nothing trusts the browser's word.

export async function noteAsMember(
  entryId: number,
  body: string,
): Promise<Ok<{ note: Note; pending: boolean }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = memberNoteInput.safeParse({ body });
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

/** `owner` is the member whose guestbook it is; without it, the shared one on the front desktop. */
export async function shoutAsMember(
  body: string,
  owner?: string,
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
