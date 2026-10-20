import "server-only";

/** Sends the reset link through Resend. Returns false when mail isn't configured or the send failed. */
export async function sendResetMail(to: string, name: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  const text = `Hi ${name},\n\nSomeone asked to reset the password for your 4me account. If it was you, open this link within an hour:\n\n${link}\n\nIf it wasn't, ignore this email; nothing changes.\n\n— 4me`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject: "Reset your 4me password", text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
