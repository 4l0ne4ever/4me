"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, clockTime } from "@/lib/api";

type Line = { text: string; author: string; href: string };
type Shown = Line & { id: number; x: number; y: number };

/**
 * A 2006 screensaver for a night diary: after a while with nothing touched, the screen goes dark, fireflies drift,
 * and single lines from tonight's public pages surface and fade. Anything (a move, a key, a tap) brings the desktop
 * back. Never while a field is being written in.
 */
export function Screensaver({ minutes }: { minutes: number | null }) {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState<Shown[]>([]);
  const [clock, setClock] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  // Waiting for a quiet spell.
  useEffect(() => {
    if (!minutes) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const typing = document.activeElement?.matches("input, textarea, select, [contenteditable]");
        if (!document.hidden && !typing && !document.querySelector("dialog[open]")) setOn(true);
        else arm();
      }, minutes * 60_000);
    };
    const wake = () => {
      setOn(false);
      arm();
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [minutes]);

  // While dark: lines surface one by one, the clock keeps time.
  useEffect(() => {
    if (!on) {
      setShown([]);
      return;
    }
    let lines: Line[] = [];
    let n = 0;
    let id = 0;
    void fetch(`${API_URL}/entries/lines`)
      .then((r) => (r.ok ? (r.json() as Promise<Line[]>) : []))
      .then((l) => {
        lines = l;
      })
      .catch(() => undefined);
    const tick = () => setClock(clockTime(new Date()));
    tick();
    const clockT = window.setInterval(tick, 15_000);
    const surface = () => {
      const line = lines[n++ % Math.max(1, lines.length)];
      if (!line) return;
      // Three bands down the screen, taken in turn, so two lines never sit on each other.
      const band = (n - 1) % 3;
      const next: Shown = { ...line, id: ++id, x: 6 + Math.random() * 40, y: 10 + band * 28 + Math.random() * 10 };
      setShown((s) => [...s.slice(-1), next]);
    };
    const first = window.setTimeout(surface, 1800);
    const lineT = window.setInterval(surface, 5200);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(lineT);
      window.clearInterval(clockT);
    };
  }, [on]);

  // Fireflies.
  useEffect(() => {
    const c = canvas.current;
    if (!on || !c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const flies = Array.from({ length: Math.round(Math.min(40, w / 30)) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.5) * 12,
      t: Math.random() * 6,
      r: 1.2 + Math.random() * 1.4,
    }));
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, w, h);
      for (const f of flies) {
        f.t += dt;
        if (!reduce) {
          f.vx = Math.max(-16, Math.min(16, f.vx + (Math.random() - 0.5) * 30 * dt));
          f.vy = Math.max(-12, Math.min(12, f.vy + (Math.random() - 0.5) * 30 * dt));
          f.x = (f.x + f.vx * dt + w) % w;
          f.y = (f.y + f.vy * dt + h) % h;
        }
        const a = 0.2 + 0.8 * Math.max(0, Math.sin(f.t * 1.2));
        const glow = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
        glow.addColorStop(0, `rgba(240, 220, 140, ${0.9 * a})`);
        glow.addColorStop(0.3, `rgba(240, 190, 90, ${0.35 * a})`);
        glow.addColorStop(1, "rgba(240, 190, 90, 0)");
        g.fillStyle = glow;
        g.beginPath();
        g.arc(f.x, f.y, f.r * 7, 0, 6.283);
        g.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  if (!on) return null;
  return (
    <div className="saver" aria-hidden="true">
      <canvas ref={canvas} />
      <span className="saver-clock">{clock}</span>
      {shown.map((l) => (
        <figure key={l.id} className="saver-line" style={{ left: `${l.x}%`, top: `${l.y}%` }}>
          <blockquote>{l.text}</blockquote>
          <figcaption>{l.author}</figcaption>
        </figure>
      ))}
      <span className="saver-hint">4me · move the mouse to come back</span>
    </div>
  );
}
