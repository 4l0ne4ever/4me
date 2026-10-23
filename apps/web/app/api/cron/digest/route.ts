import { type Digest, type NightPlan, nightOf, occasionOf } from "@4me/shared";
import { API_URL, hhmm } from "@/lib/api";
import { internalApi, mailEnabled, siteUrl } from "@/lib/auth";
import { sameString } from "@/lib/crypto";
import { stopLinks } from "@/lib/digest";
import { type ErrorLine, sendDigest, sendErrorSummary, type Tonight } from "@/lib/mail";

/** Tonight, if it is not an ordinary night: the moderator's event, else the calendar's. */
async function tonightOn(): Promise<Tonight | null> {
  const night = nightOf(new Date());
  const plan = await fetch(`${API_URL}/nights/${night}/plan`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<NightPlan>) : null))
    .catch(() => null);
  const ev = plan?.event;
  if (ev) return { title: ev.title, line: ev.body, time: ev.startsAt ? hhmm(ev.startsAt) : null };
  const o = occasionOf(night);
  return o ? { title: o.title, line: o.line, time: null } : null;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every morning (Vercel Cron, vercel.json): the new pages from subscribed diaries, one email per reader who asked,
 * and a summary of the last day's errors for the site's keeper.
 * Vercel sends the CRON_SECRET as a bearer token; anything else is turned away.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameString(req.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return new Response("not found", { status: 404 });
  if (!mailEnabled()) return Response.json({ sent: 0, skipped: "mail is not configured" });
  const { asOf, due } = await internalApi<{ asOf: string; due: Digest[] }>("/digests");
  const sent: number[] = [];
  const tonight = due.length ? await tonightOn() : null;
  for (const d of due) if (await sendDigest(d, siteUrl(), stopLinks(d.userId), tonight)) sent.push(d.userId);
  // Only the ones that went out move on; a failed one is tried again tomorrow with the same pages and newer ones.
  if (sent.length) await internalApi("/digests/sent", { method: "POST", body: { userIds: sent, asOf } });

  // And for whoever keeps the site (ALERT_EMAIL): what broke in the last day, if anything did.
  let errors = 0;
  const keeper = process.env.ALERT_EMAIL;
  if (keeper) {
    const rows = await internalApi<ErrorLine[]>("/errors/recent?hours=24").catch(() => []);
    errors = rows.length;
    if (rows.length) await sendErrorSummary(keeper, rows, siteUrl());
  }
  return Response.json({ due: due.length, sent: sent.length, errors });
}
