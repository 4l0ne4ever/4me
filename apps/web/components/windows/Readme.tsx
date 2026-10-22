"use client";

import type { Me } from "@4me/shared";

/**
 * The first thing a new visitor sees: what 4me is, and the three things to do here, each one a button. It opens by
 * itself once, on a first visit; the Start menu opens it again.
 */
export function Readme({
  me,
  onRead,
  onWrite,
  onDone,
}: {
  me: Me | null;
  onRead: () => void;
  onWrite: () => void;
  onDone: () => void;
}) {
  return (
    <div className="body readme">
      <p className="rm-lead">
        4me is a diary for the night. Everyone here writes one page after dark (the mood, the weather, the song that
        was on) and reads each other&apos;s.
      </p>
      <ol className="rm-steps">
        <li>
          <b>Read tonight&apos;s pages.</b>
          <span>Every new page from everyone is in Tonight. Click a title to open it.</span>
          <button type="button" className="btn" onClick={onRead}>
            Open Tonight
          </button>
        </li>
        <li>
          <b>Answer one you liked.</b>
          <span>Leave a note at the bottom of the page, or press a smiley. No account needed.</span>
        </li>
        <li>
          <b>{me ? "Write tonight's page." : "Keep your own."}</b>
          <span>
            {me
              ? "The button on the taskbar opens Notepad. One page a night is plenty."
              : "An account gives you a diary of your own, a name, and your own Ink."}
          </span>
          {me ? (
            <button type="button" className="btn" onClick={onWrite}>
              Write tonight&apos;s page
            </button>
          ) : (
            <a className="btn" href="/welcome?start=register">
              Start your diary
            </a>
          )}
        </li>
      </ol>
      <p className="rm-tip">
        Everything opens in windows, like an old computer: the icons on the left open them, the taskbar at the bottom
        shows what&apos;s open, and the 4me button is the Start menu. The black cat is Ink; click her.
      </p>
      <div className="rm-end">
        <button type="button" className="btn" onClick={onDone}>
          Got it
        </button>
      </div>
    </div>
  );
}
