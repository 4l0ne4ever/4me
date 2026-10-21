"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { IconClose } from "./Icons";

export type Tone = "warn" | "info" | "question";

/** The message box's icon, drawn like the ones Windows had: a yellow triangle, a blue "i", a blue "?". */
function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "warn")
    return (
      <svg className="mb-icon" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 3 L30 28 H2 Z" fill="#f2c94c" stroke="#7a5b12" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="14.5" y="11" width="3" height="10" fill="#2b2105" />
        <rect x="14.5" y="23" width="3" height="3" fill="#2b2105" />
      </svg>
    );
  return (
    <svg className="mb-icon" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13.5" fill="#2f6fd6" stroke="#123b80" strokeWidth="1.5" />
      <text x="16" y="22.5" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff" fontFamily="Georgia, serif">
        {tone === "info" ? "i" : "?"}
      </text>
    </svg>
  );
}

/**
 * A 2006 message box: a small window over a dimmed desktop, with an icon, a few words and its buttons. It is a real
 * modal <dialog>, so focus stays inside, Escape closes it and the page behind can't be clicked.
 */
export function Dialog({
  title,
  tone = "info",
  onClose,
  children,
  buttons,
}: {
  title: string;
  tone?: Tone;
  onClose: () => void;
  children: ReactNode;
  /** The row of buttons along the bottom; leave it out when the content has its own (a form). */
  buttons?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // The box's own default button, rather than the title bar's close button.
      (
        d.querySelector<HTMLElement>("[data-autofocus]") ??
        d.querySelector<HTMLElement>(".mb-body input, .mb-btns .btn")
      )?.focus();
    }
    return () => d?.close();
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape already closes it (onCancel); the click is for the backdrop
    <dialog
      ref={ref}
      className="msgbox"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the dimmed desktop around the box lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bar">
        <b id={titleId}>{title}</b>
        <button type="button" className="ctl x" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="mb-body">
        <ToneIcon tone={tone} />
        <div className="mb-text">{children}</div>
      </div>
      {buttons && <div className="mb-btns">{buttons}</div>}
    </dialog>
  );
}

type Ask = {
  title: string;
  text: ReactNode;
  /** The button that goes ahead: "Delete", "Leave". */
  ok: string;
  cancel?: string;
  tone?: Tone;
  /** Going ahead can't be undone: the button is red and Cancel has the focus. */
  danger?: boolean;
};

const ConfirmContext = createContext<((ask: Ask) => Promise<boolean>) | null>(null);

/** Lets anything on the desktop ask a yes-or-no question in a message box, instead of the browser's own. */
export function ConfirmHost({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(Ask & { done: (yes: boolean) => void }) | null>(null);
  const confirm = useCallback((a: Ask) => new Promise<boolean>((done) => setAsk({ ...a, done })), []);
  const answer = (yes: boolean) => {
    ask?.done(yes);
    setAsk(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <Dialog
          title={ask.title}
          tone={ask.tone ?? (ask.danger ? "warn" : "question")}
          onClose={() => answer(false)}
          buttons={
            <>
              <button
                type="button"
                className={`btn${ask.danger ? " danger" : ""}`}
                data-autofocus={ask.danger ? undefined : true}
                onClick={() => answer(true)}
              >
                {ask.ok}
              </button>
              <button
                type="button"
                className="btn ghost"
                data-autofocus={ask.danger ? true : undefined}
                onClick={() => answer(false)}
              >
                {ask.cancel ?? "Cancel"}
              </button>
            </>
          }
        >
          {ask.text}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/** `if (!(await confirm({ title, text, ok: "Delete", danger: true }))) return;` */
export function useConfirm(): (ask: Ask) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  return confirm ?? (async (a) => window.confirm(typeof a.text === "string" ? a.text : a.title));
}
