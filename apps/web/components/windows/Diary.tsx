import { type Entry, type EntrySummary, type Inline, parseBody } from "@4me/shared";
import Link from "next/link";
import type { CSSProperties } from "react";
import { hhmm, longDate } from "@/lib/api";
import { Eq } from "../Icons";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "strike" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <s key={i}>{p.text}</s>
        ) : p.kind === "em" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <em key={i}>{p.text}</em>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const TILTS = ["-4deg", "5deg", "-2deg", "3deg"];

type Props = {
  entry: Entry | null;
  entries: EntrySummary[];
  awake: boolean;
  onPhoto: (url: string) => void;
  onSong: () => void;
  onNotes: () => void;
  onGuestbook: () => void;
};

export function Diary({ entry, entries, awake, onPhoto, onSong, onNotes, onGuestbook }: Props) {
  if (!entry) {
    return (
      <div className="body paper">
        <p className="d-note">nothing written yet.</p>
        <p style={{ marginTop: 12 }}>The first night will appear here once 4me writes it.</p>
      </div>
    );
  }
  const idx = entries.findIndex((e) => e.slug === entry.slug);
  const older = idx >= 0 ? entries[idx + 1] : entries[0];
  const newer = idx > 0 ? entries[idx - 1] : undefined;
  const blocks = parseBody(entry.body);
  const inlinePhotos = new Set(blocks.flatMap((b) => (b.kind === "photo" ? [b.index] : [])));
  const sidePhotos = entry.photos.filter((_, i) => !inlinePhotos.has(i)).slice(0, 3);

  return (
    <div className="body paper">
      {!awake && (
        <div className="asleep-box">
          <span className="d-note">shh. 4me is asleep.</span>
          The diary wakes up after 5 pm. Until then, here is the last night&apos;s page. The guestbook is always open,
          and so is Ink.
        </div>
      )}
      <span className="d-date">
        {longDate(entry.writtenAt)} — {hhmm(entry.writtenAt)}
      </span>
      <h1 className="d-title">{entry.title}</h1>
      <div className="d-cur">
        {entry.mood && (
          <span>
            Current mood: <b>{entry.mood}</b>
          </span>
        )}
        {entry.weather && (
          <span>
            Weather: <b>{entry.weather}</b>
          </span>
        )}
        <span>
          Read <b>{entry.readCount}</b> times
        </span>
      </div>
      <div className="d-grid">
        <div className="d-text">
          {blocks.map((b, i) => {
            const key = `${b.kind}-${i}`;
            if (b.kind === "note")
              return (
                <p key={key} className="d-note">
                  {b.text}
                </p>
              );
            if (b.kind === "photo") {
              const ph = entry.photos[b.index];
              return ph ? (
                <button key={key} type="button" className="pol d-inline-photo" onClick={() => onPhoto(ph.url)}>
                  <img
                    src={ph.url}
                    alt={ph.caption || "photo from this night"}
                    width={600}
                    height={600}
                    loading="lazy"
                  />
                  <span>{ph.caption}</span>
                </button>
              ) : null;
            }
            return (
              <p key={key}>
                <Inlines parts={b.parts} />
              </p>
            );
          })}
        </div>
        <div className="d-side">
          {sidePhotos.map((ph, i) => (
            <button
              key={ph.url}
              type="button"
              className="pol"
              style={{ "--tilt": TILTS[i % TILTS.length] } as CSSProperties}
              onClick={() => onPhoto(ph.url)}
              aria-label={`Open photo: ${ph.caption || "from this night"}`}
            >
              <img src={ph.url} alt={ph.caption || "photo from this night"} width={600} height={600} loading="lazy" />
              <span>{ph.caption}</span>
            </button>
          ))}
          {entry.song && (
            <button type="button" className="ticket" onClick={onSong}>
              <Eq />
              <span>
                <small>ON REPEAT</small>
                <b>{entry.song.title}</b>
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="d-foot">
        <span>{older && <Link href={`/n/${older.slug}`}>« {older.title}</Link>}</span>
        <span>
          <button type="button" className="linkish" onClick={onNotes}>
            {entry.noteCount} notes
          </button>{" "}
          ·{" "}
          <button type="button" className="linkish" onClick={onGuestbook}>
            sign the guestbook
          </button>
          {newer && (
            <>
              {" "}
              · <Link href={`/n/${newer.slug}`}>{newer.title} »</Link>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
