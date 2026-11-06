"use server";

import { signTicket } from "@4me/shared";
import { getMe, internalApi } from "./auth";

type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** Opens a new werewolf table with the member sitting at it. */
export async function openTable(): Promise<{ code: string } | { error: string }> {
  const me = await getMe();
  if (!me) return { error: "log on to open a table" };
  try {
    return await internalApi<{ code: string }>(`/users/${me.id}/tables`, { method: "POST" });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "couldn't open a table" };
  }
}

/** Gives a table's password; when it's right, the member's browser may sit down. */
export async function unlockTable(code: string, password: string): Promise<{ ok: true } | { error: string }> {
  const me = await getMe();
  if (!me) return { error: "log on to sit at a table" };
  if (!/^[a-z0-9]{6}$/.test(code)) return { error: "no such table" };
  try {
    await internalApi(`/users/${me.id}/tables/${code}/unlock`, { method: "POST", body: { password } });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "couldn't check the password" };
  }
}

/** A fresh ticket for a table's socket, while the session is still good: it keeps the socket open. */
export async function tableTicket(): Promise<string | null> {
  const me = await getMe();
  return me ? signTicket("live", me.id, process.env.ADMIN_TOKEN ?? "") : null;
}

/**
 * What a member's browser needs to sit at a table: a ten-minute ticket for the table's connection, and where to find
 * the other players for the voice (TURN credentials, when configured, never leave the server for longer than that).
 */
export async function tableSeat(): Promise<{ ticket: string; iceServers: IceServer[] } | null> {
  const me = await getMe();
  if (!me) return null;
  const ticket = await signTicket("live", me.id, process.env.ADMIN_TOKEN ?? "");
  const ice = await internalApi<{ iceServers: IceServer[] }>("/tables/ice").catch(() => ({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  }));
  return { ticket, iceServers: ice.iceServers };
}
