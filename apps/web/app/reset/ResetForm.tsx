"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPassword } from "../welcome/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null);
  return (
    <main className="welcome">
      <div className="wl-top" />
      <section className="wl-mid">
        <div className="wl-brand">
          <p className="wl-logo">4me</p>
          <h1>Choose a new password</h1>
        </div>
        <div className="wl-divider" aria-hidden="true" />
        <div className="wl-users">
          {token ? (
            <form className="wl-form" style={{ marginLeft: 0 }} action={action}>
              <input type="hidden" name="token" value={token} />
              <label className="wl-field" htmlFor="rp-password">
                New password (8 or more characters)
                <input
                  id="rp-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  aria-invalid={state?.field === "password" || undefined}
                />
              </label>
              <label className="wl-field" htmlFor="rp-confirm">
                Type it again
                <input
                  id="rp-confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  aria-invalid={state?.field === "confirm" || undefined}
                />
              </label>
              {state?.error && (
                <p className="wl-error" role="alert">
                  {state.error}
                </p>
              )}
              <button className="wl-go" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save the new password"}
              </button>
              <p className="wl-help">Every device signed in to this account will be signed out.</p>
            </form>
          ) : (
            <p className="wl-error" role="alert">
              This link isn&apos;t valid. <Link href="/welcome?start=signin">Ask for a new one</Link>.
            </p>
          )}
        </div>
      </section>
      <footer className="wl-bottom">
        <Link className="wl-off" href="/">
          <span aria-hidden="true" className="wl-power" />
          Back to the diary
        </Link>
        <p>Reset links work once, for one hour.</p>
      </footer>
    </main>
  );
}
