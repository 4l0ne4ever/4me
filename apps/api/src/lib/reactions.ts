import { type MyReactions, REACTIONS, type ReactionKind, type Reactions } from "@4me/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";
import { entries, notes, reactions, users } from "../db/schema";
import type { AppEnv } from "../env";
import { isReadable } from "./entries";
import { notify, publish, quote } from "./notify";

type Target = "entry" | "note";

/** Reaction counts for many pages or notes at once: id -> { love: 3, moon: 1 }. */
export async function countsFor(c: Context<AppEnv>, target: Target, ids: number[]): Promise<Map<number, Reactions>> {
  const out = new Map<number, Reactions>();
  if (ids.length === 0) return out;
  const rows = await c
    .get("db")
    .select({ id: reactions.targetId, kind: reactions.kind, n: sql<number>`count(*)::int` })
    .from(reactions)
    .where(and(eq(reactions.target, target), inArray(reactions.targetId, ids)))
    .groupBy(reactions.targetId, reactions.kind);
  for (const r of rows) out.set(r.id, { ...out.get(r.id), [r.kind]: r.n });
  return out;
}

/** What this reader (a member "u:<id>" or a guest's hashed IP) chose on a page and its notes. */
export async function mine(c: Context<AppEnv>, reactor: string, entryId: number): Promise<MyReactions> {
  const db = c.get("db");
  const [page] = await db
    .select({ kind: reactions.kind })
    .from(reactions)
    .where(and(eq(reactions.target, "entry"), eq(reactions.targetId, entryId), eq(reactions.reactor, reactor)));
  const onNotes = await db
    .select({ id: reactions.targetId, kind: reactions.kind })
    .from(reactions)
    .innerJoin(notes, eq(notes.id, reactions.targetId))
    .where(and(eq(reactions.target, "note"), eq(notes.entryId, entryId), eq(reactions.reactor, reactor)));
  return { entry: page?.kind ?? null, notes: Object.fromEntries(onNotes.map((r) => [r.id, r.kind])) };
}

/** The page a note or page belongs to, if anyone may read it, with whoever should hear about a reaction. */
async function whereIs(c: Context<AppEnv>, target: Target, targetId: number) {
  const db = c.get("db");
  const entryCols = {
    entryId: entries.id,
    authorId: entries.authorId,
    title: entries.title,
    slug: entries.slug,
    handle: users.handle,
  };
  if (target === "entry") {
    const [row] = await db
      .select(entryCols)
      .from(entries)
      .innerJoin(users, eq(users.id, entries.authorId))
      .where(and(isReadable, eq(entries.id, targetId)));
    return row ? { ...row, owner: row.authorId } : null;
  }
  const [row] = await db
    .select({ ...entryCols, owner: notes.userId })
    .from(notes)
    .innerJoin(entries, eq(entries.id, notes.entryId))
    .innerJoin(users, eq(users.id, entries.authorId))
    .where(and(isReadable, eq(notes.id, targetId), eq(notes.status, "visible")));
  return row ?? null;
}

/**
 * Sets (or with `kind: null` takes back) one reader's reaction, tells everyone on the page the new counts, and
 * lets the page's writer, or the note's member, know. Returns null when the page or note isn't readable.
 */
export async function react(
  c: Context<AppEnv>,
  target: Target,
  targetId: number,
  reactor: string,
  kind: ReactionKind | null,
  actor: { name: string; avatar: string | null; userId: number | null },
): Promise<Reactions | null> {
  const where = await whereIs(c, target, targetId);
  if (!where) return null;
  const db = c.get("db");
  const mineNow = and(eq(reactions.target, target), eq(reactions.targetId, targetId), eq(reactions.reactor, reactor));
  if (kind === null) await db.delete(reactions).where(mineNow);
  else
    await db
      .insert(reactions)
      .values({ target, targetId, reactor, kind })
      .onConflictDoUpdate({
        target: [reactions.target, reactions.targetId, reactions.reactor],
        set: { kind, createdAt: new Date() },
      });
  const counts = (await countsFor(c, target, [targetId])).get(targetId) ?? {};
  publish(c, [`entry:${where.entryId}`], {
    type: "reactions",
    entryId: where.entryId,
    target,
    targetId,
    reactions: counts,
  });
  if (kind && where.owner && where.owner !== actor.userId) {
    const emoji = REACTIONS.find((r) => r.id === kind)?.emoji ?? "";
    await notify(c, where.owner, {
      kind: "reaction",
      text: `${actor.name} reacted ${emoji} to ${target === "note" ? "your note on " : ""}${quote(where.title)}`,
      link: `/u/${where.handle}/${where.slug}`,
      actor: actor.userId ? { name: actor.name, avatar: actor.avatar } : null,
    });
  }
  return counts;
}

/** A page or note is gone: its reactions go with it. */
export async function dropReactions(c: Context<AppEnv>, target: Target, ids: number[]) {
  if (ids.length === 0) return;
  await c
    .get("db")
    .delete(reactions)
    .where(and(eq(reactions.target, target), inArray(reactions.targetId, ids)));
}
