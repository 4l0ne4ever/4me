"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { endSession, isAuthor, passwordMatches, startSession } from "@/lib/session";

// The moderator's actions. Members write their own pages; the moderator only keeps pages up or takes them down,
// suspends accounts, and approves held notes.

async function guard() {
  if (!(await isAuthor())) redirect("/admin");
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function login(form: FormData) {
  if (await passwordMatches(str(form, "password"))) {
    await startSession();
    redirect("/admin");
  }
  redirect("/admin?error=password");
}

export async function logout() {
  await endSession();
  redirect("/admin");
}

/** "visible" keeps a reported page up and clears its reports; "hidden" takes it down. */
export async function moderateEntry(form: FormData) {
  await guard();
  await adminApi(`/entries/${str(form, "id")}`, { method: "PATCH", body: { status: str(form, "status") } });
  revalidatePath("/", "layout");
  redirect(`/admin#${str(form, "back") || "reports"}`);
}

export async function setUserStatus(form: FormData) {
  await guard();
  await adminApi(`/users/${str(form, "id")}`, { method: "PATCH", body: { status: str(form, "status") } });
  revalidatePath("/", "layout");
  const q = str(form, "q");
  redirect(`/admin${q ? `?q=${encodeURIComponent(q)}` : ""}#members`);
}

export async function moderate(form: FormData) {
  await guard();
  const kind = str(form, "kind") === "shout" ? "shouts" : "notes";
  await adminApi(`/${kind}/${str(form, "id")}`, { method: "PATCH", body: { status: str(form, "status") } });
  revalidatePath("/", "layout");
  redirect("/admin#inbox");
}
