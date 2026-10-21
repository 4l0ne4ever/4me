"use client";

import type { Me } from "@4me/shared";
import { useState } from "react";
import { useTurnstile } from "./Turnstile";

const REASONS = [
  ["spam", "Spam or advertising"],
  ["hurtful", "Hurtful, hateful or threatening"],
  ["private", "Shares someone's private information"],
  ["other", "Something else that shouldn't be here"],
] as const;

type Result = { ok: true } | { ok: false; error: string };

/**
 * "report": a small link that opens a reason picker. Members are counted by account; guests pass Turnstile.
 * Three different readers take a page or a note down until the moderator looks.
 */
export function Report({
  me,
  what,
  send,
}: {
  me: Me | null;
  /** "page" or "note", for the question. */
  what: string;
  send: (reason: string, turnstileToken: string | undefined) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const human = useTurnstile();
  if (state === "done") return <span className="d-reported">Thanks. The moderator will look at it.</span>;
  if (!open)
    return (
      <button type="button" className="linkish" onClick={() => setOpen(true)}>
        report
      </button>
    );
  return (
    <form
      className="d-report"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return setError("pick a reason");
        setState("busy");
        const res = await send(reason, me ? undefined : human.token);
        if (!me) human.reset();
        if (!res.ok) {
          setState("idle");
          return setError(res.error);
        }
        setState("done");
      }}
    >
      <fieldset>
        <legend>What&apos;s wrong with this {what}?</legend>
        {REASONS.map(([id, label]) => (
          <label key={id}>
            <input
              type="radio"
              name={`reason-${what}`}
              value={id}
              checked={reason === id}
              onChange={() => setReason(id)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {!me && human.widget}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <span className="acc-row">
        <button className="btn" type="submit" disabled={state === "busy" || (!me && human.needed && !human.token)}>
          Send report
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </form>
  );
}
