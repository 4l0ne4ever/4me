"use server";

import { redirect } from "next/navigation";
import { internalApi, sessionSecret } from "@/lib/auth";
import { checkUnsubscribe } from "@/lib/crypto";

export async function stopDigest(form: FormData) {
  const uid = Number(form.get("u"));
  if (!checkUnsubscribe(uid, String(form.get("t") ?? ""), sessionSecret())) redirect("/unsubscribe");
  await internalApi(`/users/${uid}/digest-off`, { method: "POST" });
  redirect("/unsubscribe?done=1");
}
