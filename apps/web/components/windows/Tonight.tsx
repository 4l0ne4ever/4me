import type { EntrySummary, Me } from "@4me/shared";
import Link from "next/link";
import { hhmm, shortDate } from "@/lib/api";
import { Eq } from "../Icons";

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? `tonight, ${hhmm(iso)}` : `${shortDate(iso)}, ${hhmm(iso)}`;
}

/** Everyone's newest pages, like a LiveJournal friends page: who wrote, what, and the song that was on. */
export function Tonight({ recent, me, onWrite }: { recent: EntrySummary[]; me: Me | null; onWrite: () => void }) {
  return (
    <div className="body tonight">
      <div className="tn-head">
        {me ? (
          <>
            <span>
              Logged on as <Link href={`/u/${me.handle}`}>{me.displayName}</Link>
            </span>
            <button type="button" className="btn" onClick={onWrite}>
              Write tonight&apos;s page
            </button>
          </>
        ) : (
          <>
            <span>Everyone here keeps a night diary.</span>
            <a className="btn" href="/welcome?start=register">
              Start yours
            </a>
          </>
        )}
      </div>
      {recent.length === 0 && <p className="tn-empty">Nobody has written yet. The first page could be yours.</p>}
      <ul className="tn-list">
        {recent.map((e) => (
          <li key={e.id}>
            <Link className="tn-av" href={`/u/${e.author.handle}`} aria-label={`${e.author.name}'s desktop`}>
              <img src={e.author.avatar} alt="" width={40} height={40} />
            </Link>
            <div>
              <Link className="tn-title" href={`/u/${e.author.handle}/${e.slug}`}>
                {e.title}
              </Link>
              <small>
                <Link href={`/u/${e.author.handle}`}>{e.author.name}</Link> · {when(e.writtenAt)}
                {e.mood && ` · ${e.mood}`} · {e.noteCount} {e.noteCount === 1 ? "note" : "notes"}
              </small>
              {e.song && (
                <span className="tn-song">
                  <Eq />
                  {e.song.artist} – {e.song.title}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
