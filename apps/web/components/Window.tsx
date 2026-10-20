"use client";

import { type PointerEvent, type ReactNode, useRef } from "react";
import { IconClose, IconMin } from "./Icons";

export type Pos = { left: number; top: number };

type Props = {
  id: string;
  title: string;
  icon: ReactNode;
  className: string;
  focused: boolean;
  z: number;
  pos?: Pos;
  onFocus: () => void;
  onMinimise: () => void;
  onClose: () => void;
  onMove: (pos: Pos) => void;
  children: ReactNode;
};

/** A 2006-style window: drag it by the title bar on desktop; on phones windows simply stack. */
export function Window({
  id,
  title,
  icon,
  className,
  focused,
  z,
  pos,
  onFocus,
  onMinimise,
  onClose,
  onMove,
  children,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < 900 || (e.target as Element).closest("button")) return;
    const el = ref.current;
    const desk = el?.offsetParent as HTMLElement | null;
    if (!el || !desk) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const d = desk.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left - d.left, oy: r.top - d.top };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    const el = ref.current;
    if (!g || !el) return;
    onMove({
      left: Math.max(-el.offsetWidth + 120, Math.min(window.innerWidth - 120, g.ox + e.clientX - g.sx)),
      top: Math.max(0, Math.min(window.innerHeight - 120, g.oy + e.clientY - g.sy)),
    });
  };

  return (
    <section
      ref={ref}
      id={id}
      className={`win ${className}${focused ? " focus" : ""}`}
      style={{ zIndex: z, ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : {}) }}
      aria-label={title}
      onPointerDown={onFocus}
    >
      <div
        className="bar"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {icon}
        <b>{title}</b>
        <button type="button" className="ctl" aria-label={`Minimise ${title}`} onClick={onMinimise}>
          <IconMin />
        </button>
        <button type="button" className="ctl x" aria-label={`Close ${title}`} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {children}
    </section>
  );
}
