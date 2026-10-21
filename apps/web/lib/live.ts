"use client";

import type { LiveEvent } from "@4me/shared";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

/** Every live event the page receives, for any window that wants it. */
const bus = new EventTarget();

export function useLiveEvent(handler: (e: LiveEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const on = (e: Event) => latest.current((e as CustomEvent<LiveEvent>).detail);
    bus.addEventListener("live", on);
    return () => bus.removeEventListener("live", on);
  }, []);
}

/**
 * Fetches the latest copy of something when a window opens and again every time the live connection (re)connects,
 * so nothing written while the page was cached, or while the connection was down, is missed. Live events then keep
 * it current in between.
 */
export function useFresh<T>(url: string | null, apply: (data: T) => void) {
  const latest = useRef(apply);
  latest.current = apply;
  const load = useRef<() => void>(() => undefined);
  useEffect(() => {
    load.current = () => {
      if (!url) return;
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .then((data) => data !== null && latest.current(data))
        .catch(() => undefined);
    };
    load.current();
  }, [url]);
  useLiveEvent((e) => {
    if (e.type === "hello") load.current();
  });
}

export type LiveState = "connecting" | "live" | "offline";

/**
 * Keeps one WebSocket open to the API for these topics, reconnecting with a growing pause when it drops, and
 * passes every event to the page. `ticket` (members only) adds their own notifications.
 */
export function useLiveConnection(topics: string[], ticket: (() => Promise<string | null>) | null): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const key = topics.join(",");
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const signedIn = Boolean(ticket);

  // Reconnects when the topics (key) or sign-in change.
  useEffect(() => {
    if (!key || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let tries = 0;
    let ping = 0;
    let retry = 0;

    const connect = async () => {
      setState("connecting");
      const url = new URL("/live", API_URL);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      for (const t of key.split(",")) url.searchParams.append("t", t);
      const t = signedIn ? await ticketRef.current?.().catch(() => null) : null;
      if (t) url.searchParams.set("ticket", t);
      if (stopped) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        tries = 0;
        setState("live");
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };
      ws.onmessage = (m) => {
        if (m.data === "pong") return;
        try {
          bus.dispatchEvent(new CustomEvent("live", { detail: JSON.parse(String(m.data)) as LiveEvent }));
        } catch {
          // not ours
        }
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        if (stopped) return;
        setState("offline");
        const wait = Math.min(30_000, 1000 * 2 ** tries++) + Math.random() * 1000;
        retry = window.setTimeout(() => void connect(), wait);
      };
    };

    // Come back straight away when the network or the tab returns.
    const wake = () => {
      if (stopped || document.hidden || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING)
        return;
      window.clearTimeout(retry);
      tries = 0;
      void connect();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    void connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearInterval(ping);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      ws?.close();
    };
  }, [key, signedIn]);

  return state;
}
