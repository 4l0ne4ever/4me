"use client";

import type { Me } from "@4me/shared";
import { useEffect, useState } from "react";
import { shortDate } from "@/lib/api";
import { onThisNight, type ThenPage } from "@/lib/member-actions";

/**
 * A quiet reminder, once a night, when the member wrote on this night a year ago (or, while 4me is young, a month
 * ago): a balloon by the clock, with the page to open.
 */
export function OnThisNight({
  me,
  night,
  onOpen,
}: {
  me: Me | null;
  night: string | null;
  onOpen: (href: string) => void;
}) {
  const [then, setThen] = useState<{ page: ThenPage; when: "year" | "month" } | null>(null);
  useEffect(() => {
    if (!me || !night) return;
    const key = `4me-then-${me.id}-${night}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      void onThisNight().then((r) => {
        if (!live) return;
        const page = r.year[0] ?? r.month[0];
        if (!page) return;
        setThen({ page, when: r.year[0] ? "year" : "month" });
        try {
          localStorage.setItem(key, "1");
        } catch {
          // it may come back; harmless
        }
      });
    }, 4000);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [me, night]);

  if (!then || !me) return null;
  const years = new Date().getFullYear() - new Date(then.page.writtenAt).getFullYear();
  const label =
    then.when === "year" ? (years > 1 ? `${years} years ago tonight` : "A year ago tonight") : "A month ago tonight";
  return (
    <div className="balloon then-balloon" role="status">
      <button
        type="button"
        className="balloon-body"
        onClick={() => {
          setThen(null);
          onOpen(`/u/${me.handle}/${then.page.slug}`);
        }}
      >
        <span className="then-moon" aria-hidden="true" />
        <span>
          <b>{label}</b>
          you wrote “{then.page.title}” ({shortDate(then.page.writtenAt)}). Read it again?
        </span>
      </button>
      <button type="button" className="balloon-x" aria-label="Close" onClick={() => setThen(null)}>
        ×
      </button>
    </div>
  );
}
