import "server-only";
import type { Digest } from "@4me/shared";

type Mail = { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> };

/** Sends one email through Resend. Returns false when mail isn't configured or the send failed. */
async function send(mail: Mail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, ...mail }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends the reset link. */
export function sendResetMail(to: string, name: string, link: string): Promise<boolean> {
  const text = `Hi ${name},\n\nSomeone asked to reset the password for your 4me account. If it was you, open this link within an hour:\n\n${link}\n\nIf it wasn't, ignore this email; nothing changes.\n\n— 4me`;
  return send({ to, subject: "Reset your 4me password", text });
}

/** Sends the link that proves the address is theirs. */
export function sendCheckMail(to: string, name: string, link: string): Promise<boolean> {
  const text = `Hi ${name},\n\nOpen this link to confirm this is your address on 4me (it works for a day):\n\n${link}\n\nOnce it's confirmed, a forgotten password can be reset by email, and you can ask for new pages from the diaries you subscribe to.\n\nIf you didn't make a 4me account, ignore this email.\n\n— 4me`;
  return send({ to, subject: "Confirm your email for 4me", text });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The subject line: one writer by name, or how many pages. */
export function digestSubject(d: Digest): string {
  const writers = [...new Set(d.pages.map((p) => p.author))];
  if (d.pages.length === 1) return `${writers[0]} wrote a new page: ${d.pages[0]!.title}`;
  if (writers.length === 1) return `${writers[0]} wrote ${d.pages.length} new pages`;
  return `${d.pages.length} new pages from ${writers.slice(0, 2).join(", ")}${writers.length > 2 ? " and others" : ""}`;
}

/**
 * The morning email: the new pages, each with its first lines and a link, in plain text and in simple HTML that
 * reads like the diary (warm paper, a serif, no pictures to load). One-click unsubscribe in the headers and the
 * footer.
 */
export function digestMail(d: Digest, site: string, stop: { page: string; oneClick: string }): Mail {
  const unsubscribe = stop.page;
  const link = (p: Digest["pages"][number]) => `${site}/u/${p.handle}/${p.slug}`;
  const text = [
    `Hi ${d.name},`,
    "",
    "New on the diaries you subscribe to:",
    "",
    ...d.pages.flatMap((p) => [
      `${p.title}`,
      `${p.author}${p.mood ? ` · feeling ${p.mood}` : ""}`,
      p.excerpt,
      link(p),
      "",
    ]),
    "— 4me",
    "",
    `You get this because you asked for new pages by email. Stop: ${unsubscribe}`,
  ].join("\n");
  const pages = d.pages
    .map(
      (p) => `<tr><td style="padding:0 0 26px">
<a href="${esc(link(p))}" style="font:600 21px/1.3 Georgia,'Times New Roman',serif;color:#2a2118;text-decoration:none">${esc(p.title)}</a>
<div style="margin:4px 0 8px;font:13px/1.4 Verdana,Tahoma,sans-serif;color:#8a7a66">${esc(p.author)}${p.mood ? ` · feeling ${esc(p.mood)}` : ""}</div>
<div style="font:16px/1.6 Georgia,'Times New Roman',serif;color:#3b3127">${esc(p.excerpt)}</div>
<a href="${esc(link(p))}" style="display:inline-block;margin-top:8px;font:13px Verdana,Tahoma,sans-serif;color:#9e392f">Read the page</a>
</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ece4d6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece4d6"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7f1e6;border:1px solid #d8ccb8">
<tr><td style="padding:22px 26px 6px;font:700 15px Verdana,Tahoma,sans-serif;color:#9e392f;letter-spacing:.04em">4me</td></tr>
<tr><td style="padding:0 26px 18px;font:15px/1.5 Verdana,Tahoma,sans-serif;color:#5d5144">Hi ${esc(d.name)}, new on the diaries you subscribe to:</td></tr>
<tr><td style="padding:6px 26px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pages}</table></td></tr>
<tr><td style="padding:16px 26px 22px;border-top:1px dashed #d8ccb8;font:12px/1.5 Verdana,Tahoma,sans-serif;color:#8a7a66">You get this because you asked for new pages by email, one email a morning at most. <a href="${esc(unsubscribe)}" style="color:#8a7a66">Stop these emails</a>.</td></tr>
</table></td></tr></table></body></html>`;
  return {
    to: d.email,
    subject: digestSubject(d),
    text,
    html,
    // Mail apps show their own "unsubscribe" button for this, and POST to it with one click.
    headers: { "List-Unsubscribe": `<${stop.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export const sendDigest = (d: Digest, site: string, stop: { page: string; oneClick: string }) =>
  send(digestMail(d, site, stop));
