"use client";

import type { Author } from "@4me/shared";
import { useDesk } from "./DeskShell";

/** Subscribe to a diary, like a blog: new pages land in your Subscriptions and ring your bell. */
export function Subscribe({ author }: { author: Author }) {
  const { me, subscriptions, subscribe } = useDesk();
  if (me?.handle === author.handle) return null;
  if (!me)
    return (
      <a className="btn sub" href={`/welcome?next=${encodeURIComponent(`/u/${author.handle}`)}`}>
        Subscribe
      </a>
    );
  const on = Boolean(subscriptions?.some((s) => s.handle === author.handle));
  return (
    <button
      type="button"
      className={`btn sub${on ? " on" : ""}`}
      aria-pressed={on}
      disabled={subscriptions === null}
      title={on ? `Stop getting ${author.name}'s new pages` : `Get ${author.name}'s new pages`}
      onClick={() => void subscribe(author, !on)}
    >
      {on ? "✓ Subscribed" : "Subscribe"}
    </button>
  );
}
