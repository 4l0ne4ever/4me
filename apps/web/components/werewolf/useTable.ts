"use client";

import type { TableEvent, TableMessage, TableView } from "@4me/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { tableSeat } from "@/lib/table-actions";
import { type IceServer, Voice, type VoiceState } from "./voice";

export type TableStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * Sits this browser at a table: one WebSocket that brings this player's view of the game and carries what they do,
 * reconnecting when it drops, and the voice that rides on it for its handshakes.
 */
export function useTable(code: string | null, me: number | null, attempt = 0) {
  const [view, setView] = useState<TableView | null>(null);
  const [status, setStatus] = useState<TableStatus>("connecting");
  const [closed, setClosed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  /** How far this browser's clock is behind the table's. */
  const [skew, setSkew] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const voiceRef = useRef<Voice | null>(null);

  const send = useCallback((msg: TableMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` knocks again (after giving the table's password)
  useEffect(() => {
    if (!code || !me) return;
    let stopped = false;
    let tries = 0;
    let retry = 0;
    let ping = 0;
    setView(null);
    setClosed(null);
    setStatus("connecting");

    const connect = async () => {
      const seat = await tableSeat().catch(() => null);
      if (stopped) return;
      if (!seat) {
        setClosed("log on to sit at a table");
        setStatus("closed");
        return;
      }
      if (!voiceRef.current) {
        voiceRef.current = new Voice(
          me,
          (to, data) => send({ t: "signal", to, data }),
          seat.iceServers as IceServer[],
          setVoice,
        );
        setVoice(voiceRef.current.state);
      }
      const url = new URL(`/tables/${code}/ws`, API_URL);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", seat.ticket);
      const socket = new WebSocket(url);
      ws.current = socket;
      let finalWord: string | null = null;
      socket.onopen = () => {
        tries = 0;
        setStatus("open");
        ping = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
      };
      socket.onmessage = (m) => {
        if (m.data === "pong") return;
        let e: TableEvent;
        try {
          e = JSON.parse(String(m.data)) as TableEvent;
        } catch {
          return;
        }
        if (e.t === "view") {
          setSkew(e.view.now - Date.now());
          setView(e.view);
        } else if (e.t === "signal") void voiceRef.current?.signal(e.from, e.data as never);
        else if (e.t === "error") setNotice(e.error);
        else if (e.t === "closed") finalWord = e.reason;
      };
      socket.onclose = (ev) => {
        window.clearInterval(ping);
        if (stopped) return;
        // Turned away, kicked, or the table was put away: don't knock again.
        if (finalWord || ev.code >= 4000 || ev.code === 1000) {
          setClosed(finalWord ?? (ev.reason || "you left the table"));
          setStatus("closed");
          voiceRef.current?.leave();
          return;
        }
        setStatus("reconnecting");
        retry = window.setTimeout(() => void connect(), Math.min(15_000, 600 * 2 ** tries++));
      };
    };
    void connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearInterval(ping);
      ws.current?.close(1000);
      ws.current = null;
      voiceRef.current?.leave();
      voiceRef.current = null;
      setVoice(null);
    };
  }, [code, me, send, attempt]);

  // The voice follows the game: who is here, and who may hear whom.
  useEffect(() => {
    const v = voiceRef.current;
    if (!v || !view) return;
    v.setTable(
      view.players.filter((p) => p.connected).map((p) => p.id),
      view.voice.speakTo,
      view.voice.hear,
    );
  }, [view]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(t);
  }, [notice]);

  return { view, status, closed, notice, send, voice, voiceCtl: voiceRef, skew };
}
