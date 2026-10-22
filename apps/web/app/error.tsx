"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportBrowserError } from "@/lib/report-actions";

/** Something broke while drawing a page: say so plainly, and offer to try again. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Told to the moderator's error log, once, with the page it happened on.
  useEffect(() => {
    void reportBrowserError(`${error.name}: ${error.message}`, window.location.pathname, error.digest);
  }, [error]);
  return (
    <main className="paper" style={{ maxWidth: 560, margin: "12vh auto", padding: 32 }}>
      <p className="d-note">the ink smudged.</p>
      <h1 className="d-title">This page didn&apos;t load</h1>
      <p style={{ fontSize: 18, lineHeight: 1.6 }}>
        Something went wrong on our side. It is usually gone a moment later.
      </p>
      <p style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18 }}>
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
        <Link href="/">Go back to tonight&apos;s page</Link>
      </p>
    </main>
  );
}
