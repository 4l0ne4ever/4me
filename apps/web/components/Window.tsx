"use client";

import { type PointerEvent, type ReactNode, useRef } from "react";
import { IconClose, IconMax, IconMin, IconRestore } from "./Icons";

export type Pos = { left: number; top: number };
export type Size = { width: number; height: number };

/** The smallest a window can be made by dragging its edge. */
const MIN_W = 300;
const MIN_H = 180;
type Edge = "e" | "s" | "se";

type Props = {
  id: string;
  title: string;
  icon: ReactNode;
  className: string;
  focused: boolean;
  z: number;
  pos?: Pos;
  /** Filling the desktop (on a computer; on a phone every window already does). */
  max?: boolean;
  onMaximise?: () => void;
  /** Set by dragging the window's right or bottom edge (on a computer). */
  size?: Size;
  onResize?: (size: Size) => void;
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
  max = false,
  onMaximise,
  size,
  onResize,
  onFocus,
  onMinimise,
  onClose,
  onMove,
  children,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const sizing = useRef<{
    edge: Edge;
    sx: number;
    sy: number;
    w: number;
    h: number;
    maxW: number;
    maxH: number;
  } | null>(null);

  const grab = (edge: Edge) => (e: PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    const desk = el?.offsetParent as HTMLElement | null;
    if (!el || !desk || max || window.innerWidth < 900) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const d = desk.getBoundingClientRect();
    // anchor the top-left corner where it is, so only the dragged edge moves
    if (!pos) onMove({ left: r.left - d.left, top: r.top - d.top });
    sizing.current = {
      edge,
      sx: e.clientX,
      sy: e.clientY,
      w: r.width,
      h: r.height,
      maxW: d.right - r.left,
      maxH: d.bottom - r.top,
    };
    onFocus();
  };
  const stretch = (e: PointerEvent<HTMLSpanElement>) => {
    const g = sizing.current;
    if (!g || !onResize) return;
    const width = g.edge === "s" ? g.w : Math.max(MIN_W, Math.min(g.maxW, g.w + e.clientX - g.sx));
    const height = g.edge === "e" ? g.h : Math.max(MIN_H, Math.min(g.maxH, g.h + e.clientY - g.sy));
    onResize({ width: Math.round(width), height: Math.round(height) });
  };
  const letGo = () => {
    sizing.current = null;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (max || window.innerWidth < 900 || (e.target as Element).closest("button")) return;
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
      className={`win ${className}${focused ? " focus" : ""}${max ? " max" : ""}`}
      style={{
        zIndex: z,
        ...(pos && !max ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : {}),
        ...(size && !max ? { width: size.width, height: size.height } : {}),
      }}
      aria-label={title}
      onPointerDown={onFocus}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging and double-clicking the title bar are mouse shortcuts; the buttons in it do the same from the keyboard */}
      <div
        className="bar"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={(e) => {
          // like Windows: a double click on the title bar maximises, and restores
          if (onMaximise && window.innerWidth >= 900 && !(e.target as Element).closest("button")) onMaximise();
        }}
      >
        {icon}
        <b>{title}</b>
        <button type="button" className="ctl" aria-label={`Minimise ${title}`} onClick={onMinimise}>
          <IconMin />
        </button>
        {onMaximise && (
          <button
            type="button"
            className="ctl mx"
            aria-label={max ? `Restore ${title}` : `Maximise ${title}`}
            title={max ? "Restore" : "Maximise"}
            onClick={onMaximise}
          >
            {max ? <IconRestore /> : <IconMax />}
          </button>
        )}
        <button type="button" className="ctl x" aria-label={`Close ${title}`} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {children}
      {onResize &&
        !max &&
        (["e", "s", "se"] as const).map((edge) => (
          <span
            key={edge}
            className={`grip grip-${edge}`}
            aria-hidden="true"
            onPointerDown={grab(edge)}
            onPointerMove={stretch}
            onPointerUp={letGo}
            onPointerCancel={letGo}
          />
        ))}
    </section>
  );
}
