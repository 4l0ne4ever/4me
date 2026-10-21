"use client";

import type { Me } from "@4me/shared";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { useTurnstile } from "./Turnstile";

const REASONS = [
  ["spam", "Spam or advertising"],
  ["hurtful", "Hurtful, hateful or threatening"],
  ["private", "Shares someone's private information"],
  ["other", "Something else that shouldn't be here"],
] as const;

type Result = { ok: true } | { ok: false; error: string };
type Send = (reason: string, turnstileToken: string | undefined) => Promise<Result>;

/**
 * "report": a small link that opens a message box with the reasons. Members are counted by account; guests pass
 * Turnstile. Three different readers take a page or a note down until the moderator looks.
 */
export function Report({
  me,
  what,
  send,
}: {
  me: Me | null;
  /** "page" or "note", for the question. */
  what: string;
  send: Send;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="d-reported">Thanks. The moderator will look at it.</span>;
  return (
    <>
      <button type="button" className="linkish" onClick={() => setOpen(true)}>
        report
      </button>
      {open && (
        <Dialog title={`Report this ${what}`} tone="warn" onClose={() => setOpen(false)}>
          <ReportForm
            me={me}
            what={what}
            send={send}
            onCancel={() => setOpen(false)}
            onDone={() => {
              setOpen(false);
              setDone(true);
            }}
          />
        </Dialog>
      )}
    </>
  );
}

/** The reasons, inside the box. Mounted only while the box is open, so Turnstile draws into it. */
function ReportForm({
  me,
  what,
  send,
  onCancel,
  onDone,
}: {
  me: Me | null;
  what: string;
  send: Send;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const human = useTurnstile();
  return (
    <form
      className="mb-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return setError("pick a reason");
        setBusy(true);
        const res = await send(reason, me ? undefined : human.token);
        if (!me) human.reset();
        setBusy(false);
        if (!res.ok) return setError(res.error);
        onDone();
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
      <p className="mb-note">
        Only the moderator sees reports. When three different readers report the same {what}, it is hidden until the
        moderator looks.
      </p>
      {!me && human.widget}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="mb-btns">
        <button className="btn" type="submit" disabled={busy || (!me && human.needed && !human.token)}>
          Send report
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
