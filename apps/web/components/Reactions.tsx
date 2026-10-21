"use client";

import { REACTIONS, type ReactionKind, type Reactions } from "@4me/shared";
import { useEffect, useRef, useState } from "react";

/**
 * The little row of feelings under a page or a note: what people chose, with counts, and a smiley button to pick
 * one. Picking the same one again takes it back. One per reader, like Yahoo 360.
 */
export function ReactionBar({
  counts,
  mine,
  onPick,
  label,
  small,
}: {
  counts: Reactions;
  mine: ReactionKind | null;
  onPick: (kind: ReactionKind | null) => void;
  /** What is being reacted to, for screen readers: "this page", "moth's note". */
  label: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = REACTIONS.filter((r) => (counts[r.id] ?? 0) > 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const pick = (kind: ReactionKind) => {
    setOpen(false);
    onPick(kind === mine ? null : kind);
  };

  return (
    <div className={`rx${small ? " rx-small" : ""}`} ref={box}>
      {shown.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`rx-chip${mine === r.id ? " mine" : ""}`}
          aria-pressed={mine === r.id}
          aria-label={`${r.label}: ${counts[r.id]}${mine === r.id ? ", yours" : ""}`}
          onClick={() => pick(r.id)}
        >
          <span aria-hidden="true">{r.emoji}</span>
          {counts[r.id]}
        </button>
      ))}
      <button
        type="button"
        className="rx-add"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`React to ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">☺</span>
        {!small && shown.length === 0 && " React"}
      </button>
      {open && (
        <fieldset className="rx-pal">
          <legend className="sr">React to {label}</legend>
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={mine === r.id ? "mine" : undefined}
              aria-pressed={mine === r.id}
              title={r.label}
              aria-label={r.label}
              onClick={() => pick(r.id)}
            >
              {r.emoji}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** Applies a reader's change to counts straight away (the live update corrects it a moment later). */
export function shift(counts: Reactions, from: ReactionKind | null, to: ReactionKind | null): Reactions {
  const next = { ...counts };
  if (from) next[from] = Math.max(0, (next[from] ?? 1) - 1) || undefined;
  if (to) next[to] = (next[to] ?? 0) + 1;
  for (const k of Object.keys(next) as ReactionKind[]) if (!next[k]) delete next[k];
  return next;
}
