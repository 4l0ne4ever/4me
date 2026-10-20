"use client";

import { AVATARS, type Me, type MyNote } from "@4me/shared";
import Link from "next/link";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { signOut } from "@/app/welcome/actions";
import { shortDate } from "@/lib/api";
import { changePassword, deleteAccount, myNotes, signOutEverywhere, updateProfile } from "@/lib/member-actions";

type Msg = { kind: "ok" | "err"; text: string; field?: string } | null;

function Line({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={msg.kind === "ok" ? "acc-ok" : "err"} role={msg.kind === "ok" ? "status" : "alert"}>
      {msg.text}
    </p>
  );
}

/** My account: picture, name, my notes, password, and leaving. */
export function Account({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(me.displayName);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [notes, setNotes] = useState<MyNote[] | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState("");
  const [leaveMsg, setLeaveMsg] = useState<Msg>(null);

  useEffect(() => {
    void myNotes().then(setNotes);
  }, []);

  const save = (changes: { displayName?: string; avatar?: string }) =>
    start(async () => {
      const res = await updateProfile(changes);
      if (res.ok) {
        onMe(res.me);
        setProfileMsg({ kind: "ok", text: "Saved." });
      } else setProfileMsg({ kind: "err", text: res.error, field: res.field });
    });

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm)
      return setPwMsg({ kind: "err", text: "The two new passwords don't match.", field: "confirm" });
    start(async () => {
      const res = await changePassword(pw.current, pw.next);
      if (res.ok) {
        setPw({ current: "", next: "", confirm: "" });
        setPwMsg({ kind: "ok", text: "Password changed. Other devices have been signed out." });
        onMe({ ...me, hasPassword: true });
      } else setPwMsg({ kind: "err", text: res.error, field: res.field });
    });
  };

  return (
    <div className="body acc">
      <section className="acc-head">
        <img src={AVATARS.find((a) => a.id === me.avatar)?.url} alt="" width={64} height={64} />
        <div>
          <b>{me.displayName}</b>
          <span>{me.email ?? "no email on this account"}</span>
          <span>Member since {shortDate(me.createdAt)}</span>
        </div>
      </section>

      <fieldset className="acc-sec">
        <legend>Your picture</legend>
        <div className="acc-avatars">
          {AVATARS.map((a) => (
            <label key={a.id} className={me.avatar === a.id ? "on" : undefined} title={a.name}>
              <input
                type="radio"
                name="avatar"
                value={a.id}
                checked={me.avatar === a.id}
                onChange={() => save({ avatar: a.id })}
                disabled={pending}
              />
              <img src={a.url} alt={a.name} width={48} height={48} />
            </label>
          ))}
        </div>
      </fieldset>

      <form
        className="acc-sec"
        onSubmit={(e) => {
          e.preventDefault();
          save({ displayName: name });
        }}
      >
        <label htmlFor="acc-name">Your name in the diary</label>
        <div className="acc-row">
          <input
            id="acc-name"
            className="field"
            value={name}
            minLength={2}
            maxLength={24}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={profileMsg?.field === "displayName" || undefined}
          />
          <button className="btn" type="submit" disabled={pending || name.trim() === me.displayName}>
            Save
          </button>
        </div>
        <Line msg={profileMsg} />
      </form>

      <section className="acc-sec">
        <h3>My notes</h3>
        {notes === null && <p className="acc-dim">Loading…</p>}
        {notes?.length === 0 && <p className="acc-dim">You haven&apos;t left a note yet.</p>}
        <ul className="acc-notes">
          {notes?.map((n) => (
            <li key={n.id}>
              <p>{n.body}</p>
              <small>
                on <Link href={`/n/${n.slug}`}>{n.title}</Link> · {shortDate(n.createdAt)}
                {n.status !== "visible" && ` · ${n.status === "pending" ? "waiting for 4me" : "hidden"}`}
              </small>
            </li>
          ))}
        </ul>
      </section>

      <form className="acc-sec" onSubmit={savePassword}>
        <h3>{me.hasPassword ? "Change password" : "Set a password"}</h3>
        {!me.hasPassword && (
          <p className="acc-dim">You sign in with Google. Add a password to sign in with your email too.</p>
        )}
        {me.hasPassword && (
          <label htmlFor="acc-current">
            Current password
            <input
              id="acc-current"
              className="field"
              type="password"
              autoComplete="current-password"
              required
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              aria-invalid={pwMsg?.field === "current" || undefined}
            />
          </label>
        )}
        <label htmlFor="acc-next">
          New password (8 or more characters)
          <input
            id="acc-next"
            className="field"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            aria-invalid={pwMsg?.field === "next" || undefined}
          />
        </label>
        <label htmlFor="acc-confirm">
          Type it again
          <input
            id="acc-confirm"
            className="field"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            aria-invalid={pwMsg?.field === "confirm" || undefined}
          />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {me.hasPassword ? "Change password" : "Set password"}
        </button>
        <Line msg={pwMsg} />
      </form>

      <section className="acc-sec">
        <h3>Signing in</h3>
        <p className="acc-dim">
          Email and password: {me.hasPassword ? "on" : "off"} · Google: {me.google ? "linked" : "not linked"}
        </p>
        <div className="acc-row">
          <form action={signOut}>
            <button className="btn" type="submit">
              Log off
            </button>
          </form>
          <form action={signOutEverywhere}>
            <button className="btn" type="submit">
              Log off on every device
            </button>
          </form>
        </div>
      </section>

      <form
        className="acc-sec acc-danger"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await deleteAccount(confirm);
            if (res && !res.ok) setLeaveMsg({ kind: "err", text: res.error, field: res.field });
          });
        }}
      >
        <h3>Delete my account</h3>
        <p className="acc-dim">
          Your account, picture and Ink are deleted. Notes you left stay in the diary, signed “a former reader”. This
          can&apos;t be undone.
        </p>
        <label htmlFor="acc-delete">Type your name, {me.displayName}, to confirm</label>
        <div className="acc-row">
          <input
            id="acc-delete"
            className="field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            aria-invalid={leaveMsg?.field === "confirm" || undefined}
          />
          <button className="btn buzz" type="submit" disabled={pending || !confirm}>
            Delete
          </button>
        </div>
        <Line msg={leaveMsg} />
      </form>
    </div>
  );
}
