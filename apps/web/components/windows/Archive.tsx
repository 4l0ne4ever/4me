"use client";

import type { Author, Star } from "@4me/shared";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { API_URL, hhmm, shortDate } from "@/lib/api";
import { DeskLink } from "../DeskLink";
import { useDesk } from "../DeskShell";

const W = 640;
const H = 250;
const PAD = 22;

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthName = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

/**
 * How deep into the night a page was written: 0 at 17:00 (the horizon), 1 at 06:00 (the top of the sky).
 * Daytime pages sit at the edges: the morning after at the top, the afternoon before at the horizon.
 */
function depth(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60;
  const night = (h - 17 + 24) % 24;
  if (night <= 13) return night / 13;
  return night < 19 ? 1 : 0;
}

/**
 * The archive as a night sky, one sky per month: every page is a star, across by the day it was written and up by
 * how late in the night, brighter the more it was answered. Below the sky, the same pages as a plain list.
 */
export function Archive({ persona }: { persona: Author | null }) {
  const { navigate } = useDesk();
  const [stars, setStars] = useState<Star[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [hover, setHover] = useState<Star | null>(null);
  const handle = persona?.handle;

  useEffect(() => {
    let live = true;
    setStars(null);
    setMonth(null);
    fetch(`${API_URL}/archive${handle ? `?author=${encodeURIComponent(handle)}` : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<Star[]>) : []))
      .then((s) => live && setStars(s))
      .catch(() => live && setStars([]));
    return () => {
      live = false;
    };
  }, [handle]);

  const months = useMemo(() => {
    const by = new Map<string, Star[]>();
    for (const s of stars ?? []) {
      const k = monthKey(new Date(s.writtenAt));
      by.set(k, [...(by.get(k) ?? []), s]);
    }
    return by;
  }, [stars]);
  const keys = [...months.keys()]; // newest first, as the API sends them
  const current = month ?? keys[0] ?? null;
  const shown = current ? (months.get(current) ?? []) : [];
  const at = current ? keys.indexOf(current) : -1;

  // Pages written on this night in earlier years.
  const onThisNight = useMemo(() => {
    const now = new Date();
    return (stars ?? []).filter((s) => {
      const d = new Date(s.writtenAt);
      return d.getFullYear() < now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
  }, [stars]);

  const days = current ? new Date(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 0).getDate() : 31;
  const place = (s: Star) => {
    const d = new Date(s.writtenAt);
    const x = PAD + ((d.getDate() - 1) / Math.max(1, days - 1)) * (W - PAD * 2);
    const y = H - PAD - 14 - depth(d) * (H - PAD * 2 - 14);
    return { x, y, r: s.sealedUntil ? 3 : 2.6 + Math.min(s.glow, 24) * 0.32 };
  };
  const open = (s: Star) => navigate(`/u/${s.author.handle}/${s.slug}`);
  const key = (s: Star) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(s);
    }
  };

  if (stars === null) return <div className="body arch arch-empty">Counting the stars…</div>;
  if (stars.length === 0)
    return <div className="body arch arch-empty">No pages yet. The sky fills in as the nights are written.</div>;

  return (
    <div className="body arch">
      {onThisNight.length > 0 && (
        <div className="arch-otn">
          <b>On this night</b>
          {onThisNight.map((s) => (
            <DeskLink key={s.id} href={`/u/${s.author.handle}/${s.slug}`}>
              {new Date(s.writtenAt).getFullYear()}: {s.title}
            </DeskLink>
          ))}
        </div>
      )}
      <div className="arch-nav">
        <button type="button" className="btn" disabled={at >= keys.length - 1} onClick={() => setMonth(keys[at + 1]!)}>
          ‹ older
        </button>
        <label htmlFor="arch-month" className="sr">
          Month
        </label>
        <select id="arch-month" className="field" value={current ?? ""} onChange={(e) => setMonth(e.target.value)}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {monthName(k)} ({months.get(k)!.length})
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={at <= 0} onClick={() => setMonth(keys[at - 1]!)}>
          newer ›
        </button>
      </div>

      <figure className="arch-sky">
        <figcaption className="sr">{current ? monthName(current) : ""} as a night sky, one star per page</figcaption>
        <svg viewBox={`0 0 ${W} ${H}`}>
          <title>{current ? `${monthName(current)}: one star per page` : "the archive"}</title>
          <rect width={W} height={H} fill="#0b1530" />
          <text x={W - 10} y={18} textAnchor="end" className="arch-axis">
            06:00
          </text>
          <text x={W - 10} y={H - PAD - 18} textAnchor="end" className="arch-axis">
            17:00
          </text>
          <line x1={0} x2={W} y1={H - PAD} y2={H - PAD} stroke="#31415a" />
          {[1, 5, 10, 15, 20, 25, days].map((d) => (
            <text
              key={d}
              x={PAD + ((d - 1) / Math.max(1, days - 1)) * (W - PAD * 2)}
              y={H - 6}
              textAnchor="middle"
              className="arch-axis"
            >
              {d}
            </text>
          ))}
          {shown.map((s) => {
            const p = place(s);
            return (
              // biome-ignore lint/a11y/useSemanticElements: a star in an SVG sky, focusable and opened like a link
              <g
                key={s.id}
                role="link"
                tabIndex={0}
                className={`arch-star${s.sealedUntil ? " sealed" : ""}`}
                aria-label={`${s.title}, ${shortDate(s.writtenAt)} ${hhmm(s.writtenAt)}${s.sealedUntil ? ", sealed" : ""}`}
                onClick={() => open(s)}
                onKeyDown={key(s)}
                onPointerEnter={() => setHover(s)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(s)}
                onBlur={() => setHover(null)}
                style={{ animationDelay: `${(s.id % 9) * 0.4}s` }}
              >
                <circle cx={p.x} cy={p.y} r={p.r * 3} className="halo" />
                <circle cx={p.x} cy={p.y} r={p.r} className="core" />
              </g>
            );
          })}
        </svg>
        <p className="arch-tip" aria-hidden="true">
          {hover
            ? `${hover.title} · ${shortDate(hover.writtenAt)}, ${hhmm(hover.writtenAt)}${persona ? "" : ` · ${hover.author.name}`}`
            : "Each star is a page: across by the day, up by how late in the night, brighter the more it was answered."}
        </p>
      </figure>

      <ol className="arch-list">
        {shown.map((s) => (
          <li key={s.id}>
            <time dateTime={s.writtenAt}>{shortDate(s.writtenAt)}</time>
            <DeskLink href={`/u/${s.author.handle}/${s.slug}`}>{s.title}</DeskLink>
            <small>
              {s.sealedUntil ? `✉ sealed until ${shortDate(s.sealedUntil)}` : s.mood}
              {!persona && ` · ${s.author.name}`}
            </small>
          </li>
        ))}
      </ol>
    </div>
  );
}
