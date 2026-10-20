"use server";

import type { EntryInput, Visibility } from "@4me/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { endSession, isAuthor, passwordMatches, startSession } from "@/lib/session";

async function guard() {
  if (!(await isAuthor())) redirect("/admin");
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/", "layout");
}

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

/** datetime-local has no zone; the browser sends its offset in minutes so the time means what the author meant. */
function writtenAt(local: string, offsetMinutes: string): string | undefined {
  if (!local) return undefined;
  const off = Number(offsetMinutes) || 0;
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${local.length === 16 ? `${local}:00` : local}${zone}`;
}

export async function saveEntry(form: FormData) {
  await guard();
  const id = str(form, "id");
  const photos = str(form, "photos")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [url, ...caption] = line.split("|");
      return { url: (url ?? "").trim(), caption: caption.join("|").trim() };
    });
  const input: EntryInput = {
    title: str(form, "title"),
    slug: str(form, "slug") || undefined,
    body: str(form, "body"),
    mood: str(form, "mood"),
    weather: str(form, "weather"),
    writtenAt: writtenAt(str(form, "writtenAt"), str(form, "tz")),
    songUrl: str(form, "songUrl"),
    songTitle: str(form, "songTitle") || undefined,
    songArtist: str(form, "songArtist") || undefined,
    photos,
    visibility: (str(form, "visibility") || "public") as Visibility,
  };
  let slug = "";
  try {
    const saved = await adminApi<{ slug: string }>(id ? `/entries/${id}` : "/entries", {
      method: id ? "PUT" : "POST",
      body: input,
    });
    slug = saved.slug;
  } catch (e) {
    redirect(`/admin?${id ? `edit=${id}&` : ""}error=${encodeURIComponent((e as Error).message)}`);
  }
  refresh();
  redirect(`/admin?saved=${encodeURIComponent(slug)}`);
}

export async function deleteEntry(form: FormData) {
  await guard();
  await adminApi(`/entries/${str(form, "id")}`, { method: "DELETE" });
  refresh();
  redirect("/admin?deleted=1");
}

export async function addBlast(form: FormData) {
  await guard();
  await adminApi("/blasts", { method: "POST", body: { body: str(form, "body") } });
  refresh();
  redirect("/admin#blasts");
}

export async function deleteBlast(form: FormData) {
  await guard();
  await adminApi(`/blasts/${str(form, "id")}`, { method: "DELETE" });
  refresh();
  redirect("/admin#blasts");
}

export async function addAlmost(form: FormData) {
  await guard();
  await adminApi("/almost", { method: "POST", body: { body: str(form, "body") } });
  refresh();
  redirect("/admin#almost");
}

export async function deleteAlmost(form: FormData) {
  await guard();
  await adminApi(`/almost/${str(form, "id")}`, { method: "DELETE" });
  refresh();
  redirect("/admin#almost");
}

export async function moderate(form: FormData) {
  await guard();
  const kind = str(form, "kind") === "shout" ? "shouts" : "notes";
  await adminApi(`/${kind}/${str(form, "id")}`, { method: "PATCH", body: { status: str(form, "status") } });
  refresh();
  redirect("/admin#inbox");
}

export async function reply(form: FormData) {
  await guard();
  await adminApi(`/entries/${str(form, "entryId")}/reply`, { method: "POST", body: { body: str(form, "body") } });
  refresh();
  redirect("/admin#inbox");
}
