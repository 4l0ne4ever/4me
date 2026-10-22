import type { Digest } from "@4me/shared";
import { internalApi, mailEnabled, siteUrl } from "@/lib/auth";
import { sameString } from "@/lib/crypto";
import { stopLinks } from "@/lib/digest";
import { sendDigest } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every morning (Vercel Cron, vercel.json): the new pages from subscribed diaries, one email per reader who asked.
 * Vercel sends the CRON_SECRET as a bearer token; anything else is turned away.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameString(req.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return new Response("not found", { status: 404 });
  if (!mailEnabled()) return Response.json({ sent: 0, skipped: "mail is not configured" });
  const { asOf, due } = await internalApi<{ asOf: string; due: Digest[] }>("/digests");
  const sent: number[] = [];
  for (const d of due) if (await sendDigest(d, siteUrl(), stopLinks(d.userId))) sent.push(d.userId);
  // Only the ones that went out move on; a failed one is tried again tomorrow with the same pages and newer ones.
  if (sent.length) await internalApi("/digests/sent", { method: "POST", body: { userIds: sent, asOf } });
  return Response.json({ due: due.length, sent: sent.length });
}
