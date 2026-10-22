import "server-only";
import { internalApi, siteUrl } from "./auth";
import { sendCheckMail } from "./mail";

/** Makes a link that proves a member's address, and emails it to them. Server-side only: never an action. */
export async function sendCheck(uid: number): Promise<"sent" | "verified" | "failed"> {
  const res = await internalApi<{ verified?: boolean; token?: string; email?: string; displayName?: string }>(
    `/users/${uid}/email-check`,
    { method: "POST" },
  );
  if (res.verified) return "verified";
  if (!res.token || !res.email) return "failed";
  const ok = await sendCheckMail(res.email, res.displayName ?? "there", `${siteUrl()}/verify?token=${res.token}`);
  return ok ? "sent" : "failed";
}
