import type { Metadata } from "next";
import Link from "next/link";
import { ApiError, internalApi } from "@/lib/auth";
import { Notice } from "../welcome/Notice";

// The token is in the address: never send it on as a referrer, never index the page.
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type Search = { searchParams: Promise<Record<string, string | undefined>> };

/** Opened from the confirmation email: the address is proven, or the link has gone stale. */
export default async function VerifyPage({ searchParams }: Search) {
  const { token = "" } = await searchParams;
  let error: string | null = null;
  if (!/^[0-9a-f]{64}$/.test(token)) error = "This link isn't complete. Open it again from the email.";
  else
    try {
      await internalApi("/email-checks/consume", { method: "POST", body: { token } });
    } catch (e) {
      error =
        e instanceof ApiError && e.status !== 500
          ? `${e.message[0]?.toUpperCase()}${e.message.slice(1)}.`
          : "Something went wrong. Try the link again in a moment.";
    }
  return (
    <Notice title={error ? "That link didn't work" : "Your email is confirmed"}>
      {error ? (
        <>
          <p className="wl-error" role="alert">
            {error}
          </p>
          <p className="wl-help">Ask for a new one from Start → My account.</p>
        </>
      ) : (
        <p className="wl-help">
          A forgotten password can now be reset by email, and you can ask for new pages from the diaries you subscribe
          to, from Start → My account.
        </p>
      )}
      <Link className="wl-go" href="/">
        Back to the diaries
      </Link>
    </Notice>
  );
}
