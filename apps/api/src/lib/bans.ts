import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import { diaryBans } from "../db/schema";
import type { AppEnv } from "../env";

/** Whether this writer has kept this person off their diary: a member by account, a guest by hashed IP. */
export async function bannedFrom(
  c: Context<AppEnv>,
  ownerId: number,
  who: { userId?: number | null; ipHash?: string | null },
): Promise<boolean> {
  const match = [
    who.userId ? eq(diaryBans.userId, who.userId) : undefined,
    who.ipHash ? eq(diaryBans.ipHash, who.ipHash) : undefined,
  ].filter((m) => m !== undefined);
  if (!match.length) return false;
  const [row] = await c
    .get("db")
    .select({ id: diaryBans.id })
    .from(diaryBans)
    .where(and(eq(diaryBans.ownerId, ownerId), or(...match)))
    .limit(1);
  return Boolean(row);
}

export const BANNED = "the writer of this diary isn't taking notes from you";
