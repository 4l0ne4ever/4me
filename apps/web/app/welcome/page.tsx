import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe, googleEnabled, mailEnabled } from "@/lib/auth";
import { safeNext } from "@/lib/crypto";
import { Welcome } from "./Welcome";
import "./welcome.css";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "google-off": "Google sign-in isn't switched on here yet.",
  "google-cancelled": "Google sign-in was cancelled.",
  "google-expired": "That sign-in took too long or came from another tab. Try again.",
  "google-failed": "Google sign-in didn't work this time. Try again.",
};

type Search = { searchParams: Promise<Record<string, string | undefined>> };

export default async function WelcomePage({ searchParams }: Search) {
  const q = await searchParams;
  const next = safeNext(q.next);
  if (await getMe()) redirect(next);
  return (
    <Welcome
      next={next}
      google={googleEnabled()}
      mail={mailEnabled()}
      start={q.start === "register" ? "register" : q.start === "signin" ? "signin" : null}
      notice={q.reset === "1" ? "Your password is changed. Sign in with the new one." : null}
      error={q.error ? (ERRORS[q.error] ?? null) : null}
    />
  );
}
