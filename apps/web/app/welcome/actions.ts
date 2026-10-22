"use server";

import { email as emailSchema, password as passwordSchema, registerInput, signInInput } from "@4me/shared";
import { redirect } from "next/navigation";
import { ApiError, endSession, internalApi, type MeWithVersion, mailEnabled, siteUrl, startSession } from "@/lib/auth";
import { sendCheck } from "@/lib/checks";
import { DUMMY_HASH, hashPassword, safeNext, verifyPassword } from "@/lib/crypto";
import { sendResetMail } from "@/lib/mail";

export type FormState = { error?: string; field?: string; notice?: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const WRONG = "Wrong email or password.";

export async function register(_prev: FormState, form: FormData): Promise<FormState> {
  if (str(form, "password") !== str(form, "confirm"))
    return { error: "The two passwords don't match.", field: "confirm" };
  const parsed = registerInput.safeParse({
    displayName: str(form, "displayName"),
    email: str(form, "email"),
    password: str(form, "password"),
    turnstileToken: str(form, "cf-turnstile-response") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Check the form.", field: String(issue?.path[0] ?? "") };
  }
  let me: MeWithVersion;
  try {
    me = await internalApi<MeWithVersion>("/users", {
      method: "POST",
      body: {
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        turnstileToken: parsed.data.turnstileToken,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return { error: capital(e.message), field: e.field };
    return { error: "Something went wrong. Try again in a moment." };
  }
  await startSession(me.id, me.sessionVersion);
  // A link to prove the address. Best effort: the account works either way, and the link can be asked for again.
  if (mailEnabled()) await sendCheck(me.id).catch(() => undefined);
  redirect(safeNext(str(form, "next")));
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signInInput.safeParse({ email: str(form, "email"), password: str(form, "password") });
  if (!parsed.success) return { error: WRONG, field: "password" };
  let user: { id: number; passwordHash: string; sessionVersion: number } | null;
  try {
    ({ user } = await internalApi<{ user: typeof user }>("/sign-in", {
      method: "POST",
      body: { email: parsed.data.email },
    }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return { error: capital(e.message) };
    return { error: "Something went wrong. Try again in a moment." };
  }
  // Always run the hash, even for unknown addresses, so timing doesn't reveal who has an account.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: WRONG, field: "password" };
  await startSession(user.id, user.sessionVersion);
  redirect(safeNext(str(form, "next")));
}

export async function signOut() {
  await endSession();
  redirect("/");
}

export async function forgot(_prev: FormState, form: FormData): Promise<FormState> {
  if (!mailEnabled()) return { error: "Password reset by email isn't switched on here yet." };
  const parsed = emailSchema.safeParse(str(form, "email"));
  if (!parsed.success) return { error: "That doesn't look like an email address.", field: "email" };
  try {
    const res = await internalApi<{ token: string | null; displayName?: string }>("/resets", {
      method: "POST",
      body: { email: parsed.data },
    });
    if (res.token)
      await sendResetMail(parsed.data, res.displayName ?? "there", `${siteUrl()}/reset?token=${res.token}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return { error: capital(e.message) };
    return { error: "Something went wrong. Try again in a moment." };
  }
  // The same words whether or not the address has an account.
  return { notice: "If that address has an account, a reset link is on its way. It works for one hour." };
}

export async function resetPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "This link isn't valid. Ask for a new one." };
  if (str(form, "password") !== str(form, "confirm"))
    return { error: "The two passwords don't match.", field: "confirm" };
  const pw = passwordSchema.safeParse(str(form, "password"));
  if (!pw.success)
    return { error: capital(pw.error.issues[0]?.message ?? "Choose another password."), field: "password" };
  try {
    await internalApi("/resets/consume", {
      method: "POST",
      body: { token, passwordHash: await hashPassword(pw.data) },
    });
  } catch (e) {
    return { error: e instanceof ApiError ? capital(e.message) : "Something went wrong. Try again in a moment." };
  }
  redirect("/welcome?reset=1");
}

function capital(s: string) {
  return s ? s[0]!.toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : s;
}
