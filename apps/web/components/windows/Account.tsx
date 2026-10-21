"use client";

import { AVATARS, type Me, type MyNote } from "@4me/shared";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { signOut } from "@/app/welcome/actions";
import { shortDate } from "@/lib/api";
import { changePassword, deleteAccount, myNotes, signOutEverywhere, updateProfile } from "@/lib/member-actions";
import { DeskLink } from "../DeskLink";

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
  const [about, setAbout] = useState({ handle: me.handle, bio: me.bio, lastfmUser: me.lastfmUser });
  const [aboutMsg, setAboutMsg] = useState<Msg>(null);
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

  const saveAbout = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await updateProfile(about);
      if (res.ok) {
        onMe(res.me);
        setAboutMsg({ kind: "ok", text: "Saved." });
      } else setAboutMsg({ kind: "err", text: res.error, field: res.field });
    });
  };

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
          <span>
            <a href={`/u/${me.handle}`}>/u/{me.handle}</a>
          </span>
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

      <form className="acc-sec" onSubmit={saveAbout}>
        <h3>Your desktop</h3>
        <label htmlFor="acc-handle">
          Address: /u/…
          <input
            id="acc-handle"
            className="field"
            value={about.handle}
            minLength={2}
            maxLength={20}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_]*"
            autoComplete="off"
            onChange={(e) => setAbout({ ...about, handle: e.target.value.toLowerCase() })}
            aria-invalid={aboutMsg?.field === "handle" || undefined}
          />
        </label>
        <label htmlFor="acc-bio">
          A line about you (on your desktop)
          <input
            id="acc-bio"
            className="field"
            value={about.bio}
            maxLength={160}
            placeholder="night shifts, early trams."
            onChange={(e) => setAbout({ ...about, bio: e.target.value })}
          />
        </label>
        <label htmlFor="acc-lastfm">
          Last.fm username, to show what you&apos;re listening to (optional)
          <input
            id="acc-lastfm"
            className="field"
            value={about.lastfmUser}
            maxLength={15}
            autoComplete="off"
            onChange={(e) => setAbout({ ...about, lastfmUser: e.target.value.trim() })}
            aria-invalid={aboutMsg?.field === "lastfmUser" || undefined}
          />
        </label>
        {about.handle !== me.handle && (
          <p className="acc-dim">Links to your old address stop working once you change it.</p>
        )}
        <span className="acc-row">
          <button className="btn" type="submit" disabled={pending}>
            Save
          </button>
        </span>
        <Line msg={aboutMsg} />
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
                on <DeskLink href={`/u/${n.handle}/${n.slug}`}>{n.title}</DeskLink> · {shortDate(n.createdAt)}
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
          Your account, your pages and their photos, your guestbook, picture and Ink are deleted. Notes you left on
          other people&apos;s pages stay, signed “a former reader”. This can&apos;t be undone.
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
