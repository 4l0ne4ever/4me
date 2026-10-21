import type { Metadata } from "next";
import Link from "next/link";
import { adminApi } from "@/lib/admin-api";
import { shortDate } from "@/lib/api";
import { isAuthor } from "@/lib/session";
import { login, logout, moderate, moderateEntry, setUserStatus } from "./actions";
import "./admin.css";

export const metadata: Metadata = { title: "Moderation", robots: { index: false } };
export const dynamic = "force-dynamic";

type Report = {
  id: number;
  slug: string;
  title: string;
  status: string;
  handle: string;
  author: string;
  count: number;
  reasons: string[];
  latest: string;
};
type NoteReport = {
  id: number;
  body: string;
  name: string;
  status: string;
  slug: string;
  title: string;
  handle: string;
  count: number;
  reasons: string[];
};
type Hidden = { id: number; slug: string; title: string; handle: string; author: string; updatedAt: string };
type Member = {
  id: number;
  handle: string;
  name: string;
  email: string | null;
  status: string;
  createdAt: string;
  nights: number;
};
type Held = { id: number; name: string; body: string; createdAt: string; status: string };
type HeldNote = Held & { slug: string; title: string; handle: string };
type HeldShout = Held & { owner: string | null };
type Search = { searchParams: Promise<Record<string, string | undefined>> };

const REASON: Record<string, string> = {
  spam: "spam",
  hurtful: "hurtful",
  private: "private information",
  other: "something else",
};

function Login({ failed }: { failed: boolean }) {
  return (
    <main className="admin">
      <section className="win focus admin-win admin-login" aria-label="Log in">
        <div className="bar">
          <b>Moderator log on</b>
        </div>
        <form action={login} className="admin-form">
          <p>
            This is where the site is looked after. Readers can go back to the <Link href="/">diaries</Link>.
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

function EntryButtons({ id, status, back }: { id: number; status: string; back: string }) {
  return (
    <span className="admin-mod">
      {status !== "visible" || back === "reports" ? (
        <form action={moderateEntry}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="visible" />
          <input type="hidden" name="back" value={back} />
          <button className="btn" type="submit">
            {status === "visible" ? "Keep up" : "Restore"}
          </button>
        </form>
      ) : null}
      {status === "visible" && (
        <form action={moderateEntry}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="hidden" />
          <input type="hidden" name="back" value={back} />
          <button className="btn" type="submit">
            Hide
          </button>
        </form>
      )}
    </span>
  );
}

export default async function Admin({ searchParams }: Search) {
  const q = await searchParams;
  if (!(await isAuthor())) return <Login failed={q.error === "password"} />;
  const query = (q.q ?? "").trim();

  const [reports, noteReports, hidden, members, notes, shouts] = await Promise.all([
    adminApi<Report[]>("/reports"),
    adminApi<NoteReport[]>("/note-reports"),
    adminApi<Hidden[]>("/entries/hidden"),
    adminApi<Member[]>(`/users${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    adminApi<HeldNote[]>("/notes?status=pending"),
    adminApi<HeldShout[]>("/shouts?status=pending"),
  ]);

  return (
    <main className="admin">
      <header className="admin-top">
        <b>4me · moderation</b>
        <span>
          <Link href="/">View the diaries</Link>
          <form action={logout}>
            <button type="submit" className="btn">
              Log off
            </button>
          </form>
        </span>
      </header>

      <div className="admin-grid">
        <div className="admin-side">
          <section className="win focus admin-win" id="reports" aria-labelledby="h-reports">
            <div className="bar">
              <b id="h-reports">Reported pages ({reports.length})</b>
            </div>
            <p className="admin-note">
              A page reported by three different readers is hidden until you look. Keep up clears its reports.
            </p>
            <ul className="admin-list">
              {reports.length === 0 && <li>No reports. Quiet night.</li>}
              {reports.map((r) => (
                <li key={r.id}>
                  <span>
                    <Link href={`/u/${r.handle}/${r.slug}`}>{r.title}</Link>
                    <small>
                      by {r.author} · {r.count} {r.count === 1 ? "report" : "reports"} (
                      {r.reasons.map((x) => REASON[x] ?? x).join(", ")}) · {shortDate(r.latest)}
                      {r.status === "hidden" && " · hidden now"}
                    </small>
                  </span>
                  <EntryButtons id={r.id} status={r.status} back="reports" />
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="note-reports" aria-labelledby="h-note-reports">
            <div className="bar">
              <b id="h-note-reports">Reported notes ({noteReports.length})</b>
            </div>
            <p className="admin-note">Three different readers hide a note. Show puts it back and clears its reports.</p>
            <ul className="admin-list">
              {noteReports.length === 0 && <li>No reported notes.</li>}
              {noteReports.map((n) => (
                <li key={n.id}>
                  <span>
                    {n.body}
                    <small>
                      {n.name} on <Link href={`/u/${n.handle}/${n.slug}`}>“{n.title}”</Link> · {n.count}{" "}
                      {n.count === 1 ? "report" : "reports"} ({n.reasons.map((x) => REASON[x] ?? x).join(", ")})
                      {n.status !== "visible" && " · hidden now"}
                    </small>
                  </span>
                  <Moderate kind="note" id={n.id} />
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="hidden" aria-labelledby="h-hidden">
            <div className="bar">
              <b id="h-hidden">Hidden pages ({hidden.length})</b>
            </div>
            <ul className="admin-list">
              {hidden.length === 0 && <li>Nothing hidden.</li>}
              {hidden.map((h) => (
                <li key={h.id}>
                  <span>
                    {h.title}
                    <small>
                      by {h.author} (/u/{h.handle}) · {shortDate(h.updatedAt)}
                    </small>
                  </span>
                  <EntryButtons id={h.id} status="hidden" back="hidden" />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="admin-side">
          <section className="win admin-win" id="members" aria-labelledby="h-members">
            <div className="bar">
              <b id="h-members">Members</b>
            </div>
            <form className="admin-inline" method="get" action="/admin#members">
              <label htmlFor="q" className="sr">
                Find a member
              </label>
              <input id="q" name="q" className="field" defaultValue={query} placeholder="name, address or email" />
              <button className="btn" type="submit">
                Find
              </button>
            </form>
            <ul className="admin-list">
              {members.map((m) => (
                <li key={m.id}>
                  <span>
                    <Link href={`/u/${m.handle}`}>{m.name}</Link>
                    <small>
                      /u/{m.handle} · {m.email ?? "no email"} · {m.nights} pages · since {shortDate(m.createdAt)}
                      {m.status === "suspended" && " · suspended"}
                    </small>
                  </span>
                  <form action={setUserStatus}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="q" value={query} />
                    <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                    <button className="btn" type="submit">
                      {m.status === "active" ? "Suspend" : "Restore"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>

          <section className="win admin-win" id="inbox" aria-labelledby="h-inbox">
            <div className="bar">
              <b id="h-inbox">Held notes and shouts ({notes.length + shouts.length})</b>
            </div>
            <p className="admin-note">Anything with a link waits. Writers can also approve notes on their own pages.</p>
            <ul className="admin-list">
              {notes.length + shouts.length === 0 && <li>Nothing waiting.</li>}
              {notes.map((n) => (
                <li key={`n${n.id}`}>
                  <span>
                    {n.body}
                    <small>
                      {n.name} on <Link href={`/u/${n.handle}/${n.slug}`}>“{n.title}”</Link>
                    </small>
                  </span>
                  <Moderate kind="note" id={n.id} />
                </li>
              ))}
              {shouts.map((s) => (
                <li key={`s${s.id}`}>
                  <span>
                    {s.body}
                    <small>
                      {s.name} in {s.owner ? `/u/${s.owner}'s guestbook` : "the shared guestbook"}
                    </small>
                  </span>
                  <Moderate kind="shout" id={s.id} />
                </li>
              ))}
            </ul>
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
