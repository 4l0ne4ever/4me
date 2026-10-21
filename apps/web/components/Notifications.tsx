"use client";

import type { Me, Notification } from "@4me/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveEvent } from "@/lib/live";
import { markRead, myNotifications } from "@/lib/live-actions";
import { useDesk } from "./DeskShell";
import { chime } from "./ink/sounds";

const OS_KEY = "4me-os-notifications";

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function osAllowed(): boolean {
  try {
    return localStorage.getItem(OS_KEY) === "on" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * The tray's bell: what happened on the member's pages, a balloon when something new comes in (and, if they
 * switched it on, a notification from their own computer while the tab is in the background).
 */
export function Notifications({ me }: { me: Me }) {
  const { navigate } = useDesk();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [balloon, setBalloon] = useState<Notification | null>(null);
  const [os, setOs] = useState(false);
  const balloonTimer = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void myNotifications().then((r) => {
      setItems(r.items);
      setUnread(r.unread);
    });
    setOs(osAllowed());
  }, []);

  const go = useCallback(
    (n: Notification) => {
      setOpen(false);
      setBalloon(null);
      if (!n.read) {
        setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
        void markRead([n.id]);
      }
      navigate(n.link);
    },
    [navigate],
  );

  useLiveEvent((e) => {
    if (e.type !== "notify") return;
    const n = e.notification;
    setItems((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list].slice(0, 30)));
    setUnread((u) => u + 1);
    setBalloon(n);
    chime();
    window.clearTimeout(balloonTimer.current);
    balloonTimer.current = window.setTimeout(() => setBalloon(null), 7000);
    if (document.hidden && osAllowed()) {
      try {
        const sys = new Notification("4me", {
          body: n.text,
          icon: n.actor?.avatar ?? "/photos/pic-229.jpg",
          tag: `4me-${n.id}`,
        });
        sys.onclick = () => {
          window.focus();
          go(n);
          sys.close();
        };
      } catch {
        // some browsers only allow these from a service worker; the balloon is enough
      }
    }
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          setOpen(false);
          bell.current?.focus();
        }
        return;
      }
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !bell.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const toggleOs = async () => {
    if (os) {
      setOs(false);
      try {
        localStorage.setItem(OS_KEY, "off");
      } catch {}
      return;
    }
    if (!("Notification" in window)) return;
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    const on = permission === "granted";
    setOs(on);
    try {
      localStorage.setItem(OS_KEY, on ? "on" : "off");
    } catch {}
  };

  const readAll = () => {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
    void markRead();
  };

  return (
    <>
      <button
        ref={bell}
        type="button"
        className="bell"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-controls="notif-panel"
        onClick={() => {
          setOpen((o) => !o);
          setBalloon(null);
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2a5 5 0 0 0-5 5v3.5L3 14h14l-2-3.5V7a5 5 0 0 0-5-5z" fill="currentColor" />
          <path d="M8 15.5a2 2 0 0 0 4 0z" fill="currentColor" />
        </svg>
        {unread > 0 && <span className="bell-n">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {balloon && !open && (
        <div className="balloon" role="status">
          <button type="button" className="balloon-body" onClick={() => go(balloon)}>
            {balloon.actor && <img src={balloon.actor.avatar} alt="" width={32} height={32} />}
            <span>
              <b>4me</b>
              {balloon.text}
            </span>
          </button>
          <button type="button" className="balloon-x" aria-label="Close" onClick={() => setBalloon(null)}>
            ×
          </button>
        </div>
      )}

      {open && (
        <div className="notif" id="notif-panel" ref={panel} role="dialog" aria-label="Notifications">
          <header>
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="linkish" onClick={readAll}>
                Mark all read
              </button>
            )}
          </header>
          {items.length === 0 && (
            <p className="notif-empty">Nothing yet. Notes, shouts and BUZZes for {me.displayName} show up here.</p>
          )}
          <ul>
            {items.map((n) => (
              <li key={n.id} className={n.read ? undefined : "unread"}>
                <button type="button" onClick={() => go(n)}>
                  {n.actor ? (
                    <img src={n.actor.avatar} alt="" width={28} height={28} />
                  ) : (
                    <span className="notif-dot" />
                  )}
                  <span>
                    {n.text}
                    <small>{ago(n.createdAt)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className="notif-os">
            <input type="checkbox" checked={os} onChange={() => void toggleOs()} />
            Also show them on my computer when 4me is in the background
          </label>
        </div>
      )}
    </>
  );
}
