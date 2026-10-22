import type { Metadata } from "next";
import Link from "next/link";
import { sessionSecret } from "@/lib/auth";
import { checkUnsubscribe } from "@/lib/crypto";
import { Notice } from "../welcome/Notice";
import { stopDigest } from "./actions";

export const metadata: Metadata = {
  title: "Stop the morning email",
  robots: { index: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type Search = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * From the link at the bottom of a morning email. It asks first, with a button, so a mail scanner opening links
 * can't unsubscribe anyone.
 */
export default async function UnsubscribePage({ searchParams }: Search) {
  const { u = "", t = "", done } = await searchParams;
  const valid = checkUnsubscribe(Number(u), t, sessionSecret());
  if (done === "1")
    return (
      <Notice title="No more morning emails">
        <p className="wl-help">You can ask for them again any time from Start → My account.</p>
        <Link className="wl-go" href="/">
          Back to the diaries
        </Link>
      </Notice>
    );
  return (
    <Notice title="Stop the morning email?">
      {valid ? (
        <form action={stopDigest}>
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="t" value={t} />
          <p className="wl-help">
            No more emails with new pages from the diaries you subscribe to. Nothing else changes.
          </p>
          <button className="wl-go" type="submit">
            Stop the emails
          </button>
        </form>
      ) : (
        <p className="wl-error" role="alert">
          This link isn&apos;t complete. Open it again from the email, or turn the emails off in Start → My account.
        </p>
      )}
    </Notice>
  );
}
