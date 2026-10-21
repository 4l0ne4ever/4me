"use server";

import { type Notification, signTicket } from "@4me/shared";
import { getMe, internalApi } from "./auth";

/** Lets this browser listen for the member's own notifications for ten minutes (it asks again on reconnect). */
export async function liveTicket(): Promise<string | null> {
  const me = await getMe();
  return me ? signTicket("live", me.id, process.env.ADMIN_TOKEN ?? "") : null;
}

export async function myNotifications(): Promise<{ items: Notification[]; unread: number }> {
  const me = await getMe();
  if (!me) return { items: [], unread: 0 };
  return internalApi<{ items: Notification[]; unread: number }>(`/users/${me.id}/notifications`).catch(() => ({
    items: [],
    unread: 0,
  }));
}

/** Marks these notifications read, or all of them. */
export async function markRead(ids?: number[]): Promise<void> {
  const me = await getMe();
  if (!me) return;
  await internalApi(`/users/${me.id}/notifications/read`, { method: "POST", body: { ids } }).catch(() => undefined);
}
