"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTurnstile } from "@/components/Turnstile";
import { type FormState, forgot, register, signIn } from "./actions";

type Panel = "signin" | "register" | "forgot" | null;
type Props = {
  next: string;
  google: boolean;
  mail: boolean;
  start: Panel;
  notice: string | null;
  error: string | null;
};

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.8 7-17z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function Field(props: {
  id: string;
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  state: FormState;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  const bad = props.state?.field === props.name;
  return (
    <label className="wl-field" htmlFor={props.id}>
      {props.label}
      <input
        id={props.id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        required={props.required ?? true}
        minLength={props.minLength}
        maxLength={props.maxLength}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${props.id}-err` : undefined}
      />
    </label>
  );
}

function Message({ state, id }: { state: FormState; id: string }) {
  if (!state) return null;
  if (state.notice)
    return (
      <p className="wl-note" role="status">
        {state.notice}
      </p>
    );
  return state.error ? (
    <p className="wl-error" role="alert" id={state.field ? `${id}-${state.field}-err` : undefined}>
      {state.error}
    </p>
  ) : null;
}

export function Welcome({ next, google, mail, start, notice, error }: Props) {
  const [panel, setPanel] = useState<Panel>(start);
  const [signInState, signInAction, signingIn] = useActionState(signIn, null);
  const [registerState, registerAction, registering] = useActionState(register, null);
  const [forgotState, forgotAction, sending] = useActionState(forgot, null);
  const human = useTurnstile();

  const tile = (id: Exclude<Panel, "forgot" | null>, title: string, sub: string, avatar: string) => (
    <button
      type="button"
      className="wl-tile"
      aria-expanded={panel === id || (id === "signin" && panel === "forgot")}
      onClick={() => setPanel(panel === id ? null : id)}
    >
      <img src={avatar} alt="" width={56} height={56} />
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </button>
  );

  return (
    <main className="welcome">
      <div className="wl-top" />
      <section className="wl-mid">
        <div className="wl-brand">
          <p className="wl-logo">4me</p>
          <h1>To begin, click your name</h1>
          {notice && (
            <p className="wl-note" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="wl-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="wl-divider" aria-hidden="true" />
        <div className="wl-users">
          <Link className="wl-tile" href={next}>
            <img src="/photos/pic-229.jpg" alt="" width={56} height={56} />
            <span>
              <b>Guest</b>
              <small>Read and leave notes without an account</small>
            </span>
          </Link>

          {tile("signin", "I have an account", "Sign in with your email", "/photos/pic-1014.jpg")}
          {panel === "signin" && (
            <form className="wl-form" action={signInAction}>
              <input type="hidden" name="next" value={next} />
              <Field id="si-email" label="Email" name="email" type="email" autoComplete="email" state={signInState} />
              <Field
                id="si-password"
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                state={signInState}
              />
              <Message state={signInState} id="si" />
              <div className="wl-row">
                <button className="wl-go" type="submit" disabled={signingIn}>
                  {signingIn ? "Signing in…" : "Sign in"}
                </button>
                {mail && (
                  <button type="button" className="wl-link" onClick={() => setPanel("forgot")}>
                    Forgot your password?
                  </button>
                )}
              </div>
            </form>
          )}
          {panel === "forgot" && (
            <form className="wl-form" action={forgotAction}>
              <p className="wl-help">Type your email and we&apos;ll send a link to choose a new password.</p>
              <Field id="fp-email" label="Email" name="email" type="email" autoComplete="email" state={forgotState} />
              <Message state={forgotState} id="fp" />
              <div className="wl-row">
                <button className="wl-go" type="submit" disabled={sending}>
                  {sending ? "Sending…" : "Send the link"}
                </button>
                <button type="button" className="wl-link" onClick={() => setPanel("signin")}>
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {tile(
            "register",
            "Create a new account",
            "Keep your name, a picture, and Ink on every device",
            "/photos/pic-660.jpg",
          )}
          {panel === "register" && (
            <form className="wl-form" action={registerAction}>
              <input type="hidden" name="next" value={next} />
              <Field
                id="rg-name"
                label="Your name in the diary"
                name="displayName"
                autoComplete="nickname"
                state={registerState}
                minLength={2}
                maxLength={24}
              />
              <Field id="rg-email" label="Email" name="email" type="email" autoComplete="email" state={registerState} />
              <Field
                id="rg-password"
                label="Password (8 or more characters)"
                name="password"
                type="password"
                autoComplete="new-password"
                state={registerState}
                minLength={8}
                maxLength={128}
              />
              <Field
                id="rg-confirm"
                label="Type it again"
                name="confirm"
                type="password"
                autoComplete="new-password"
                state={registerState}
                minLength={8}
                maxLength={128}
              />
              {human.widget}
              <Message state={registerState} id="rg" />
              <button className="wl-go" type="submit" disabled={registering || (human.needed && !human.token)}>
                {registering ? "Creating…" : "Create my account"}
              </button>
              <p className="wl-help">
                Your email is only used to sign in and to reset your password. It is never shown to anyone.
              </p>
            </form>
          )}

          {google && (
            <a className="wl-google" href={`/auth/google?next=${encodeURIComponent(next)}`}>
              <GoogleG />
              Continue with Google
            </a>
          )}
        </div>
      </section>
      <footer className="wl-bottom">
        <Link className="wl-off" href="/">
          <span aria-hidden="true" className="wl-power" />
          Back to the diary
        </Link>
        <p>
          After you log on, you can change your picture and name. Just go to Start, then My account.{" "}
          <Link href="/privacy">What we keep about you</Link>.
        </p>
      </footer>
    </main>
  );
}
