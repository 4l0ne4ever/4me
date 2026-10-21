import { avatarUrl, type LiveEvent, type Notification } from "@4me/shared";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import { notifications } from "../db/schema";
import type { AppEnv } from "../env";

/** Runs after the response on Workers; elsewhere (Node, tests) it just runs. A failed broadcast never fails a write. */
function later(c: Context<AppEnv>, work: Promise<unknown>) {
  const safe = work.catch((e) => console.error(`live: ${e instanceof Error ? e.message : "failed"}`));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    // no execution context outside Workers
  }
}

/** Tells everyone listening to these topics. */
export function publish(c: Context<AppEnv>, topics: string[], event: LiveEvent) {
  const live = c.get("live");
  if (live) later(c, Promise.resolve(live.publish(topics, event)));
}

type Row = typeof notifications.$inferSelect;
export const toNotification = (r: Row): Notification => ({
  id: r.id,
  kind: r.kind,
  text: r.text,
  link: r.link,
  actor: r.actorName ? { name: r.actorName, avatar: r.actorAvatar ?? avatarUrl(null) } : null,
  createdAt: r.createdAt.toISOString(),
  read: r.readAt !== null,
});

type NewNotification = {
  kind: Row["kind"];
  text: string;
  link: string;
  actor?: { name: string; avatar: string | null } | null;
};

/**
 * Keeps a notification for a member (so they see it later) and pushes it to them if they are online.
 * A BUZZ on the same page that is still unread is not repeated.
 */
export async function notify(c: Context<AppEnv>, userId: number, n: NewNotification) {
  const db = c.get("db");
  if (n.kind === "buzz") {
    const [recent] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, "buzz"),
          eq(notifications.link, n.link),
          isNull(notifications.readAt),
          gt(notifications.createdAt, new Date(Date.now() - 10 * 60_000)),
        ),
      )
      .limit(1);
    if (recent) return;
  }
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      kind: n.kind,
      text: n.text.slice(0, 300),
      link: n.link,
      actorName: n.actor?.name ?? null,
      actorAvatar: n.actor ? avatarUrl(n.actor.avatar) : null,
    })
    .returning();
  // Old ones go eventually: two months is plenty for "what did I miss".
  if (Math.random() < 0.02) {
    await db
      .delete(notifications)
      .where(
        and(eq(notifications.userId, userId), lt(notifications.createdAt, new Date(Date.now() - 60 * 86_400_000))),
      );
  }
  publish(c, [`user:${userId}`], { type: "notify", notification: toNotification(row!) });
}

export async function recentNotifications(c: Context<AppEnv>, userId: number) {
  const rows = await c
    .get("db")
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  return rows.map(toNotification);
}

/** “Lan left a note on “The last tram”” — titles are trimmed so the balloon stays one or two lines. */
export const quote = (title: string) => `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”`;
