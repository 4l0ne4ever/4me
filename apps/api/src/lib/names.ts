import { nameKey } from "@4me/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { users } from "../db/schema";
import type { AppEnv } from "../env";
import { isReservedName } from "./guard";

/**
 * Anonymous readers may use any name except the author's and the ones members own,
 * so nobody can write as someone else. Returns the reason, or null when the name is free.
 */
export async function anonymousNameProblem(c: Context<AppEnv>, name: string): Promise<string | null> {
  if (name === "a stranger") return null;
  if (isReservedName(name)) return "That name is taken. Pick another one.";
  const [owner] = await c
    .get("db")
    .select({ id: users.id })
    .from(users)
    .where(eq(users.nameKey, nameKey(name)))
    .limit(1);
  return owner ? "That name belongs to a member. Sign in, or pick another name." : null;
}
