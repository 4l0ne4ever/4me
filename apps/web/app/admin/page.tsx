import type { Almost, Blast, Entry, Shout } from "@4me/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { adminApi } from "@/lib/admin-api";
import { apiGet, shortDate } from "@/lib/api";
import { isAuthor } from "@/lib/session";
import {
  addAlmost,
  addBlast,
  deleteAlmost,
  deleteBlast,
  deleteEntry,
  login,
  logout,
  moderate,
  reply,
  saveEntry,
} from "./actions";
import { TzField } from "./TzField";
import "./admin.css";

export const metadata: Metadata = { title: "Write", robots: { index: false } };
export const dynamic = "force-dynamic";

type AdminNote = {
  id: number;
  name: string;
  body: string;
  createdAt: string;
  slug: string;
  title: string;
  status: string;
  isAuthor: boolean;
};
type AdminShout = Shout & { status: string };
type Search = { searchParams: Promise<Record<string, string | undefined>> };

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Login({ failed }: { failed: boolean }) {
  return (
    <main className="admin">
      <section className="win focus admin-win admin-login" aria-label="Log in">
        <div className="bar">
          <b>Log on to 4me</b>
        </div>
        <form action={login} className="admin-form">
          <p>
            This is where 4me writes. Readers can go back to the <Link href="/">diary</Link>.
          </p>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="field"
            autoComplete="current-password"
            required
          />
          {failed && <p className="err">That password didn&apos;t work.</p>}
          <button className="btn" type="submit">
            Log on
          </button>
        </form>
      </section>
    </main>
  );
}

export default async function Admin({ searchParams }: Search) {
  const q = await searchParams;
  if (!(await isAuthor())) return <Login failed={q.error === "password"} />;

  const [entries, notes, shouts, blasts, almost] = await Promise.all([
    adminApi<Entry[]>("/entries"),
    adminApi<AdminNote[]>("/notes"),
    adminApi<AdminShout[]>("/shouts"),
    apiGet<Blast[]>("/blasts?limit=20", 0),
    apiGet<Almost[]>("/almost", 0),
  ]);
  const editing = q.edit ? entries.find((e) => String(e.id) === q.edit) : undefined;
  const pending = notes.filter((n) => n.status === "pending");
  const pendingShouts = shouts.filter((s) => s.status === "pending");
  const latestPublic = entries.find((e) => e.visibility === "public");

  return (
    <main className="admin">
      <header className="admin-top">
        <b>4me · author</b>
        <span>
          <Link href="/">View the diary</Link>
          <form action={logout}>
            <button type="submit" className="btn">
              Log off
            </button>
          </form>
        </span>
      </header>

      {q.saved && (
        <p className="admin-flash" role="status">
          Saved. <Link href={`/n/${q.saved}`}>Open the page</Link>
        </p>
      )}
      {q.error && q.error !== "password" && (
        <p className="admin-flash err" role="alert">
          Not saved: {q.error}
        </p>
      )}

      <div className="admin-grid">
        <section className="win focus admin-win" aria-labelledby="h-write">
          <div className="bar">
            <b id="h-write">{editing ? `Editing: ${editing.title}` : "Write tonight's page"}</b>
          </div>
          <form action={saveEntry} className="admin-form" key={editing?.id ?? "new"}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <TzField />
            <label htmlFor="title">Title</label>
            <input id="title" name="title" className="field" required maxLength={140} defaultValue={editing?.title} />
            <label htmlFor="body">The night</label>
            <textarea id="body" name="body" className="field" rows={14} required defaultValue={editing?.body} />
            <p className="hint">
              Blank line for a new paragraph. ~~words~~ crosses out. _words_ for italic. A line starting with &gt;
              becomes a handwritten note. [photo 2] puts the second photo inline.
            </p>
            <div className="row3">
              <span>
                <label htmlFor="mood">Mood</label>
                <input
                  id="mood"
                  name="mood"
                  className="field"
                  maxLength={40}
                  defaultValue={editing?.mood}
                  placeholder="drifting"
                />
              </span>
              <span>
                <label htmlFor="weather">Weather</label>
                <input
                  id="weather"
                  name="weather"
                  className="field"
                  maxLength={60}
                  defaultValue={editing?.weather}
                  placeholder="drizzle, 9°"
                />
              </span>
              <span>
                <label htmlFor="writtenAt">Written at</label>
                <input
                  id="writtenAt"
                  name="writtenAt"
                  type="datetime-local"
                  className="field"
                  defaultValue={editing ? toLocalInput(editing.writtenAt) : ""}
                />
              </span>
            </div>
            <label htmlFor="songUrl">Song link (Spotify, YouTube or SoundCloud)</label>
            <input
              id="songUrl"
              name="songUrl"
              type="url"
              className="field"
              defaultValue={editing?.song?.url}
              placeholder="https://open.spotify.com/track/…"
            />
            <div className="row2">
              <span>
                <label htmlFor="songTitle">Song title (optional)</label>
                <input id="songTitle" name="songTitle" className="field" defaultValue={editing?.song?.title} />
              </span>
              <span>
                <label htmlFor="songArtist">Artist (optional)</label>
                <input id="songArtist" name="songArtist" className="field" defaultValue={editing?.song?.artist} />
              </span>
            </div>
            <label htmlFor="photos">Photos, one per line: url | caption</label>
            <textarea
              id="photos"
              name="photos"
              className="field"
              rows={3}
              defaultValue={editing?.photos.map((p) => `${p.url} | ${p.caption}`).join("\n")}
              placeholder="/photos/pic-832.jpg | after, writing"
            />
            <div className="row2">
              <span>
                <label htmlFor="visibility">Who can read it</label>
                <select
                  id="visibility"
                  name="visibility"
                  className="field"
                  defaultValue={editing?.visibility ?? "public"}
                >
                  <option value="public">Everyone</option>
                  <option value="private">Only me</option>
                  <option value="draft">Draft</option>
                </select>
              </span>
              <span>
                <label htmlFor="slug">Address (optional)</label>
                <input
                  id="slug"
                  name="slug"
                  className="field"
                  defaultValue={editing?.slug}
                  placeholder="made from the title"
                />
              </span>
            </div>
            <div className="admin-actions">
              <button className="btn" type="submit">
                {editing ? "Save changes" : "Post this page"}
              </button>
              {editing && <Link href="/admin">Cancel</Link>}
            </div>
          </form>
        </section>

        <div className="admin-side">
          <section className="win admin-win" aria-labelledby="h-pages">
            <div className="bar">
              <b id="h-pages">Pages ({entries.length})</b>
            </div>
            <ul className="admin-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <span>
                    <Link href={`/admin?edit=${e.id}`}>{e.title}</Link>
                    <small>
                      {shortDate(e.writtenAt)} · {e.visibility} · {e.readCount} reads · {e.noteCount} notes
                    </small>
                  </span>
                  <form action={deleteEntry}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="btn" type="submit" aria-label={`Delete ${e.title}`}>
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="blasts" aria-labelledby="h-blasts">
            <div className="bar">
              <b id="h-blasts">Blast</b>
            </div>
            <form action={addBlast} className="admin-inline">
              <label htmlFor="blast" className="sr">
                New blast
              </label>
              <input
                id="blast"
                name="body"
                className="field"
                maxLength={140}
                placeholder="rain again. no one's coming."
                required
              />
              <button className="btn" type="submit">
                Blast
              </button>
            </form>
            <ul className="admin-list">
              {(blasts ?? []).map((b) => (
                <li key={b.id}>
                  <span>
                    {b.body}
                    <small>{shortDate(b.createdAt)}</small>
                  </span>
                  <form action={deleteBlast}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="btn" type="submit" aria-label="Delete blast">
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="almost" aria-labelledby="h-almost">
            <div className="bar">
              <b id="h-almost">Almost posted</b>
            </div>
            <form action={addAlmost} className="admin-inline">
              <label htmlFor="almost-body" className="sr">
                A line you took back
              </label>
              <input
                id="almost-body"
                name="body"
                className="field"
                maxLength={280}
                placeholder="a line you took back"
                required
              />
              <button className="btn" type="submit">
                Bin it
              </button>
            </form>
            <ul className="admin-list">
              {(almost ?? []).map((a) => (
                <li key={a.id}>
                  <span>
                    <s>{a.body}</s>
                  </span>
                  <form action={deleteAlmost}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="btn" type="submit" aria-label="Remove from the bin">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="inbox" aria-labelledby="h-inbox">
            <div className="bar">
              <b id="h-inbox">Inbox ({pending.length + pendingShouts.length} waiting)</b>
            </div>
            <ul className="admin-list">
              {pending.length + pendingShouts.length === 0 && <li>Nothing waiting for you.</li>}
              {pending.map((n) => (
                <li key={`n${n.id}`}>
                  <span>
                    {n.body}
                    <small>
                      {n.name} on “{n.title}”
                    </small>
                  </span>
                  <Moderate kind="note" id={n.id} />
                </li>
              ))}
              {pendingShouts.map((s) => (
                <li key={`s${s.id}`}>
                  <span>
                    {s.body}
                    <small>{s.name} in the guestbook</small>
                  </span>
                  <Moderate kind="shout" id={s.id} />
                </li>
              ))}
            </ul>
            {latestPublic && (
              <form action={reply} className="admin-inline">
                <input type="hidden" name="entryId" value={latestPublic.id} />
                <label htmlFor="reply" className="sr">
                  Reply on {latestPublic.title}
                </label>
                <input
                  id="reply"
                  name="body"
                  className="field"
                  maxLength={500}
                  placeholder={`reply on “${latestPublic.title}”`}
                  required
                />
                <button className="btn" type="submit">
                  Reply
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Moderate({ kind, id }: { kind: "note" | "shout"; id: number }) {
  return (
    <span className="admin-mod">
      {(["visible", "hidden"] as const).map((status) => (
        <form action={moderate} key={status}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={status} />
          <button className="btn" type="submit">
            {status === "visible" ? "Show" : "Hide"}
          </button>
        </form>
      ))}
    </span>
  );
}
