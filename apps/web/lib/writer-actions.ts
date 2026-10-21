"use server";

import {
  type Almost,
  almostInput,
  type Blast,
  blastInput,
  type Entry,
  type EntryInput,
  entryInput,
  type InboxNote,
  type MyEntry,
  reportReason,
  signTicket,
} from "@4me/shared";
import { revalidatePath } from "next/cache";
import { type Fail, fail, type Ok, signedOut } from "./action-result";
import { getMe, internalApi, type MeWithVersion } from "./auth";

// What a member does in their Notepad: write, edit and delete pages, blast, bin lines, read the notes left on their
// pages. Every action reads the session again; the member id never comes from the browser.

type EditableEntry = Entry & { songId: number | null };

const suspended: Fail = { ok: false, error: "your account can't post right now" };

/** Their desktop and the front one show their pages, so both are rebuilt after a change. */
function refresh(me: MeWithVersion, slug?: string) {
  revalidatePath("/");
  revalidatePath(`/u/${me.handle}`);
  if (slug) revalidatePath(`/u/${me.handle}/${slug}`);
}

const firstIssue = (issues: { message: string; path: PropertyKey[] }[]): Fail => ({
  ok: false,
  error: issues[0]?.message ?? "check the page",
  field: String(issues[0]?.path[0] ?? ""),
});

/** Lets the browser send photos straight to the API for ten minutes, without the server token. */
export async function uploadTicket(): Promise<Ok<{ ticket: string }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  if (me.suspended) return suspended;
  return { ok: true, ticket: await signTicket("upload", me.id, process.env.ADMIN_TOKEN ?? "") };
}

export async function myEntries(): Promise<MyEntry[]> {
  const me = await getMe();
  if (!me) return [];
  return internalApi<MyEntry[]>(`/users/${me.id}/entries`).catch(() => []);
}

export async function myEntry(id: number): Promise<EditableEntry | null> {
  const me = await getMe();
  if (!me || !Number.isInteger(id)) return null;
  return internalApi<EditableEntry>(`/users/${me.id}/entries/${id}`).catch(() => null);
}

/** Creates a page, or saves an existing one when `id` is given. */
export async function saveEntry(id: number | null, page: EntryInput): Promise<Ok<{ entry: Entry }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  if (me.suspended) return suspended;
  const input = entryInput.safeParse(page);
  if (!input.success) return firstIssue(input.error.issues);
  try {
    const entry = await internalApi<Entry>(id ? `/users/${me.id}/entries/${id}` : `/users/${me.id}/entries`, {
      method: id ? "PUT" : "POST",
      body: input.data,
    });
    refresh(me, entry.slug);
    return { ok: true, entry };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEntry(id: number): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/entries/${id}`, { method: "DELETE" });
    refresh(me);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function myBlasts(): Promise<Blast[]> {
  const me = await getMe();
  return me ? internalApi<Blast[]>(`/users/${me.id}/blasts`).catch(() => []) : [];
}

export async function addBlast(body: string): Promise<Ok<{ blast: Blast }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  if (me.suspended) return suspended;
  const input = blastInput.safeParse({ body });
  if (!input.success) return firstIssue(input.error.issues);
  try {
    const blast = await internalApi<Blast>(`/users/${me.id}/blasts`, { method: "POST", body: input.data });
    refresh(me);
    return { ok: true, blast };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBlast(id: number): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/blasts/${id}`, { method: "DELETE" });
    refresh(me);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function myAlmost(): Promise<Almost[]> {
  const me = await getMe();
  return me ? internalApi<Almost[]>(`/users/${me.id}/almost`).catch(() => []) : [];
}

export async function addAlmost(body: string): Promise<Ok<{ item: Almost }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  if (me.suspended) return suspended;
  const input = almostInput.safeParse({ body });
  if (!input.success) return firstIssue(input.error.issues);
  try {
    const item = await internalApi<Almost>(`/users/${me.id}/almost`, { method: "POST", body: input.data });
    refresh(me);
    return { ok: true, item };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAlmost(id: number): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/almost/${id}`, { method: "DELETE" });
    refresh(me);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Notes other people left on the member's pages, the ones waiting for approval first. */
export async function myInbox(): Promise<InboxNote[]> {
  const me = await getMe();
  if (!me) return [];
  const notes = await internalApi<InboxNote[]>(`/users/${me.id}/inbox`).catch(() => []);
  return [...notes.filter((n) => n.status === "pending"), ...notes.filter((n) => n.status !== "pending")];
}

export async function moderateNote(id: number, status: "visible" | "hidden"): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/inbox/${id}`, { method: "PATCH", body: { status } });
    refresh(me);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A signed-in reader reports someone else's page. Guests report straight to the API with Turnstile. */
export async function reportAsMember(entryId: number, reason: string): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const parsed = reportReason.safeParse(reason);
  if (!parsed.success || !Number.isInteger(entryId)) return { ok: false, error: "pick a reason" };
  try {
    await internalApi(`/users/${me.id}/reports/${entryId}`, { method: "POST", body: { reason: parsed.data } });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
