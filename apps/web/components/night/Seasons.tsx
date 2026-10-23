"use client";

import { useEffect, useRef } from "react";
import { type Fx, seasonFx } from "./calendar";

type P = { x: number; y: number; vx: number; vy: number; r: number; a: number; spin: number; t: number; hue: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** How many of each, for a screen of this width. */
const COUNT: Record<Fx, number> = {
  mai: 22,
  lanterns: 10,
  bats: 3,
  snow: 60,
  drizzle: 90,
  petals: 26,
  fireflies: 18,
  leaves: 18,
};

function spawn(fx: Fx, w: number, h: number, anywhere: boolean): P {
  const p: P = {
    x: rnd(0, w),
    y: anywhere ? rnd(0, h) : rnd(-60, -10),
    vx: 0,
    vy: 0,
    r: 1,
    a: 1,
    spin: 0,
    t: rnd(0, 6.28),
    hue: 0,
  };
  switch (fx) {
    case "snow":
      Object.assign(p, { r: rnd(1, 2.6), vy: rnd(18, 46), vx: rnd(-8, 8), a: rnd(0.5, 0.95) });
      break;
    case "drizzle":
      Object.assign(p, { r: rnd(9, 16), vy: rnd(260, 380), vx: -rnd(60, 90), a: rnd(0.22, 0.42) });
      break;
    case "mai":
    case "petals":
    case "leaves":
      Object.assign(p, {
        r: fx === "leaves" ? rnd(5, 8) : rnd(3.5, 6),
        vy: rnd(16, 34),
        vx: rnd(-14, 10),
        spin: rnd(-1.6, 1.6),
        a: rnd(0.75, 1),
        hue: Math.random(),
      });
      break;
    case "lanterns":
      Object.assign(p, {
        y: anywhere ? rnd(h * 0.1, h * 0.95) : h + rnd(20, 120),
        r: rnd(11, 18),
        vy: -rnd(8, 16),
        a: rnd(0.75, 1),
        hue: Math.random(),
      });
      break;
    case "fireflies":
      Object.assign(p, { y: rnd(h * 0.35, h * 0.95), r: rnd(1.4, 2.4), vx: rnd(-10, 10), vy: rnd(-6, 6), a: 0 });
      break;
    case "bats":
      Object.assign(p, {
        x: Math.random() < 0.5 ? -40 : w + 40,
        y: rnd(h * 0.06, h * 0.3),
        r: rnd(7, 11),
        a: 0.9,
      });
      p.vx = p.x < 0 ? rnd(70, 120) : -rnd(70, 120);
      break;
  }
  return p;
}

function star(g: CanvasRenderingContext2D, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  g.closePath();
}

function draw(g: CanvasRenderingContext2D, fx: Fx, p: P) {
  g.save();
  g.translate(p.x, p.y);
  g.globalAlpha = p.a;
  switch (fx) {
    case "snow":
      g.fillStyle = "#f4f6fb";
      g.beginPath();
      g.arc(0, 0, p.r, 0, 6.283);
      g.fill();
      break;
    case "drizzle":
      g.strokeStyle = "#cfd8e6";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(p.r * 0.22, -p.r);
      g.stroke();
      break;
    case "mai": {
      g.rotate(p.spin * p.t);
      g.fillStyle = "#f6c945";
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        g.beginPath();
        g.ellipse(Math.cos(a) * p.r * 0.6, Math.sin(a) * p.r * 0.6, p.r * 0.55, p.r * 0.42, a, 0, 6.283);
        g.fill();
      }
      g.fillStyle = "#d9731f";
      g.beginPath();
      g.arc(0, 0, p.r * 0.28, 0, 6.283);
      g.fill();
      break;
    }
    case "petals":
      g.rotate(p.spin * p.t);
      g.fillStyle = p.hue > 0.5 ? "#f4a7c4" : "#f9d1de";
      g.beginPath();
      g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 6.283);
      g.fill();
      break;
    case "leaves":
      g.rotate(p.spin * p.t + Math.sin(p.t * 2) * 0.6);
      g.fillStyle = p.hue > 0.66 ? "#c9652a" : p.hue > 0.33 ? "#a8471c" : "#d9a13a";
      g.beginPath();
      g.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, 6.283);
      g.fill();
      g.strokeStyle = "rgba(60, 30, 10, 0.6)";
      g.beginPath();
      g.moveTo(-p.r, 0);
      g.lineTo(p.r * 1.25, 0);
      g.stroke();
      break;
    case "fireflies": {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, p.r * 6);
      glow.addColorStop(0, "rgba(236, 255, 140, 0.95)");
      glow.addColorStop(0.25, "rgba(200, 240, 90, 0.45)");
      glow.addColorStop(1, "rgba(200, 240, 90, 0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, 0, p.r * 6, 0, 6.283);
      g.fill();
      break;
    }
    case "lanterns": {
      // đèn ông sao: a five-pointed paper star with a candle in it, on a stick
      g.rotate(Math.sin(p.t * 0.8) * 0.12);
      g.shadowColor = "rgba(255, 140, 60, 0.9)";
      g.shadowBlur = 18;
      g.fillStyle = p.hue > 0.5 ? "#e0453a" : "#f2b33d";
      star(g, p.r);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255, 236, 170, 0.9)";
      g.beginPath();
      g.arc(0, 0, p.r * 0.22, 0, 6.283);
      g.fill();
      g.strokeStyle = "rgba(90, 60, 40, 0.8)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, p.r * 0.45);
      g.lineTo(0, p.r * 2.6);
      g.stroke();
      break;
    }
    case "bats": {
      const flap = Math.sin(p.t * 14) * 0.6;
      g.scale(p.vx < 0 ? -1 : 1, 1);
      g.fillStyle = "#0b0a10";
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(-p.r * 0.6, -p.r * (0.6 + flap), -p.r * 1.4, -p.r * flap * 0.4);
      g.quadraticCurveTo(-p.r * 0.7, p.r * 0.1, 0, p.r * 0.25);
      g.quadraticCurveTo(p.r * 0.7, p.r * 0.1, p.r * 1.4, -p.r * flap * 0.4);
      g.quadraticCurveTo(p.r * 0.6, -p.r * (0.6 + flap), 0, 0);
      g.fill();
      break;
    }
  }
  g.restore();
}

/**
 * The season on the desktop: drizzle in Hà Nội's winter, apricot blossom at Tết, star lanterns at Mid-Autumn, bats
 * at Halloween, snow only at Christmas, petals, fireflies and falling leaves in between. Behind the windows, never in
 * the way; off for readers who ask for less motion, and resting in a hidden tab.
 */
export function Seasons({ on, awake }: { on: boolean; awake: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!canvas || !on || reduce.matches) return;
    const fx = seasonFx(new Date());
    // Fireflies only come out after dark.
    if (fx === "fireflies" && !awake) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const n = Math.round(COUNT[fx] * Math.min(1.4, Math.max(0.5, w / 1400)));
    const ps = Array.from({ length: fx === "bats" ? 0 : n }, () => spawn(fx, w, h, true));
    let bats = 0;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, w, h);
      // Bats come by in twos and threes, now and then.
      if (fx === "bats" && ps.length === 0 && now > bats) {
        const k = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < k; i++) ps.push(spawn(fx, w, h, false));
        bats = now + rnd(9000, 20000);
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!;
        p.t += dt;
        if (fx === "fireflies") {
          p.vx += rnd(-12, 12) * dt;
          p.vy += rnd(-12, 12) * dt;
          p.vx = Math.max(-14, Math.min(14, p.vx));
          p.vy = Math.max(-10, Math.min(10, p.vy));
          p.a = 0.25 + 0.75 * Math.max(0, Math.sin(p.t * 1.3));
        } else if (fx === "bats") {
          p.y += Math.sin(p.t * 3) * 0.6;
        } else if (fx !== "drizzle" && fx !== "lanterns") {
          p.vx += Math.sin(p.t * 1.1) * 4 * dt;
        } else if (fx === "lanterns") {
          p.x += Math.sin(p.t * 0.6) * 0.15;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const gone =
          fx === "lanterns"
            ? p.y < -60
            : fx === "bats"
              ? p.x < -60 || p.x > w + 60
              : fx === "fireflies"
                ? false
                : p.y > h + 30 || p.x < -40 || p.x > w + 40;
        if (fx === "fireflies") {
          if (p.x < 0 || p.x > w) p.vx = -p.vx;
          if (p.y < h * 0.3 || p.y > h) p.vy = -p.vy;
        }
        if (gone) {
          if (fx === "bats") ps.splice(i, 1);
          else ps[i] = spawn(fx, w, h, false);
          continue;
        }
        draw(g, fx, p);
      }
      raf = requestAnimationFrame(frame);
    };
    const visible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", visible);
      g.clearRect(0, 0, w, h);
    };
  }, [on, awake]);
  return <canvas ref={ref} className="seasons" />;
}
