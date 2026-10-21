import {
  addToChatInput,
  blockInput,
  type ChatMessage,
  type Conversation,
  chatMessageInput,
  handle as handleSchema,
  startChatInput,
} from "@4me/shared";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { blocks, conversationMembers, conversations, messages, users } from "../db/schema";
import type { AppEnv } from "../env";
import { positiveId } from "../lib/entries";
import { allowKey } from "../lib/guard";
import { toAuthor } from "../lib/map";
import { publish } from "../lib/notify";
import { json } from "../lib/validate";

// Private messages between members, behind /internal (only the web server, acting for a signed-in member, gets
// here). Two people share one conversation; a group holds up to twelve. Nobody else, the moderator included, has a
// way to read them through the site.

type UserRow = typeof users.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const MAX_GROUP = 12;
const PAGE = 50;

const authorOf = (u: { handle: string; displayName: string; avatar: string }) =>
  toAuthor({ handle: u.handle, name: u.displayName, avatar: u.avatar });

const toMessage = (m: MessageRow, from: UserRow | null | undefined): ChatMessage => ({
  id: m.id,
  conversationId: m.conversationId,
  from: from ? authorOf(from) : null,
  kind: m.kind,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

/** The member the web server is acting for. Suspended members can read, not send. */
async function memberOf(c: Context<AppEnv>, send = false): Promise<UserRow | Response> {
  const id = positiveId(c.req.param("id"));
  const [u] = id ? await c.get("db").select().from(users).where(eq(users.id, id)).limit(1) : [];
  if (!u) return c.json({ error: "not found" }, 404);
  if (send && u.status !== "active") return c.json({ error: "this account can't send messages right now" }, 403);
  return u;
}

/** One of the member's conversations; anyone else's is simply "not found". */
async function ownConversation(c: Context<AppEnv>, uid: number): Promise<ConversationRow | null> {
  const cid = positiveId(c.req.param("cid"));
  if (!cid) return null;
  const [row] = await c
    .get("db")
    .select({ conv: conversations })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, uid)),
    )
    .where(eq(conversations.id, cid))
    .limit(1);
  return row?.conv ?? null;
}

/** Active members by desktop address, without the asker and without repeats. */
async function peopleNamed(c: Context<AppEnv>, handles: string[], except: number): Promise<UserRow[]> {
  const wanted = [...new Set(handles.map((h) => h.trim().toLowerCase()))].filter(
    (h) => h === "4me" || handleSchema.safeParse(h).success,
  );
  if (wanted.length === 0) return [];
  const rows = await c
    .get("db")
    .select()
    .from(users)
    .where(and(inArray(users.handle, wanted), eq(users.status, "active")));
  return rows.filter((u) => u.id !== except);
}

/** Whether either side has blocked the other. */
async function blockedBetween(c: Context<AppEnv>, me: number, others: number[]): Promise<boolean> {
  if (others.length === 0) return false;
  const [hit] = await c
    .get("db")
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, me), inArray(blocks.blockedId, others)),
        and(inArray(blocks.blockerId, others), eq(blocks.blockedId, me)),
      ),
    )
    .limit(1);
  return Boolean(hit);
}

async function memberIds(c: Context<AppEnv>, cid: number): Promise<number[]> {
  const rows = await c
    .get("db")
    .select({ id: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, cid));
  return rows.map((r) => r.id);
}

/** Adds a line to a conversation, moves it to the top, and tells everyone in it (the sender's other tabs too). */
async function post(
  c: Context<AppEnv>,
  conv: ConversationRow,
  from: UserRow | null,
  kind: ChatMessage["kind"],
  body: string,
): Promise<ChatMessage> {
  const db = c.get("db");
  const [row] = await db
    .insert(messages)
    .values({ conversationId: conv.id, userId: from?.id ?? null, kind, body })
    .returning();
  await db.update(conversations).set({ lastMessageAt: row!.createdAt }).where(eq(conversations.id, conv.id));
  if (from)
    await db
      .update(conversationMembers)
      .set({ lastReadAt: row!.createdAt })
      .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, from.id)));
  const message = toMessage(row!, from);
  publish(
    c,
    (await memberIds(c, conv.id)).map((id) => `user:${id}`),
    { type: "message", message },
  );
  return message;
}

/** The member's conversations, newest first, each with who is in it, its last line and how many are unread. */
async function listFor(c: Context<AppEnv>, me: UserRow, only?: number): Promise<Conversation[]> {
  const db = c.get("db");
  const rows = await db
    .select({
      conv: conversations,
      unread: sql<number>`(
        select count(*) from ${messages} m
        where m.conversation_id = ${conversations.id}
          and m.created_at > ${conversationMembers.lastReadAt}
          and m.kind <> 'system'
          and (m.user_id is null or m.user_id <> ${me.id})
      )::int`,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, me.id), only ? eq(conversations.id, only) : undefined))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
  const ids = rows.map((r) => r.conv.id);
  if (ids.length === 0) return [];
  const people = await db
    .select({ cid: conversationMembers.conversationId, u: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, ids))
    .orderBy(conversationMembers.joinedAt);
  const lastIds = await db
    .select({ id: sql<number>`max(${messages.id})` })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .groupBy(messages.conversationId);
  const lasts = lastIds.length
    ? await db
        .select({ m: messages, u: users })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.userId))
        .where(
          inArray(
            messages.id,
            lastIds.map((r) => r.id),
          ),
        )
    : [];
  const pairs = rows.filter((r) => !r.conv.isGroup).map((r) => r.conv.id);
  const others = new Map(
    people.filter((p) => pairs.includes(p.cid) && p.u.id !== me.id).map((p) => [p.cid, p.u.id] as const),
  );
  const mineBlocked = others.size
    ? new Set(
        (
          await db
            .select({ id: blocks.blockedId })
            .from(blocks)
            .where(and(eq(blocks.blockerId, me.id), inArray(blocks.blockedId, [...others.values()])))
        ).map((b) => b.id),
      )
    : new Set<number>();
  return rows.map((r) => {
    const last = lasts.find((l) => l.m.conversationId === r.conv.id);
    const other = others.get(r.conv.id);
    return {
      id: r.conv.id,
      title: r.conv.title,
      group: r.conv.isGroup,
      members: people.filter((p) => p.cid === r.conv.id).map((p) => authorOf(p.u)),
      last: last ? toMessage(last.m, last.u) : null,
      unread: r.unread,
      lastMessageAt: r.conv.lastMessageAt.toISOString(),
      blocked: other !== undefined && mineBlocked.has(other),
    };
  });
}

const names = (people: UserRow[]) => {
  const n = people.map((p) => p.displayName);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
};

export const chatRoutes = new Hono<AppEnv>()
  .get("/users/:id/chats", async (c) => {
    const me = await memberOf(c);
    if (me instanceof Response) return me;
    return c.json(await listFor(c, me));
  })
  /** Starts a conversation, or finds the one these two people already have. */
  .post("/users/:id/chats", json(startChatInput), async (c) => {
    const me = await memberOf(c, true);
    if (me instanceof Response) return me;
    const input = c.req.valid("json");
    const people = await peopleNamed(c, input.with, me.id);
    if (people.length === 0) return c.json({ error: "there's no one by that name here" }, 404);
    if (people.length + 1 > MAX_GROUP) return c.json({ error: `a group holds ${MAX_GROUP} people at most` }, 400);
    if (
      await blockedBetween(
        c,
        me.id,
        people.map((p) => p.id),
      )
    )
      return c.json({ error: "you can't start a conversation with them" }, 403);
    const db = c.get("db");
    const group = people.length > 1;
    const pairKey = group ? null : [me.id, people[0]!.id].sort((a, b) => a - b).join(":");
    if (pairKey) {
      const [known] = await db.select().from(conversations).where(eq(conversations.pairKey, pairKey)).limit(1);
      if (known) {
        // Whoever deleted their account and came back, or was never added, is put back in.
        await db
          .insert(conversationMembers)
          .values([me, people[0]!].map((u) => ({ conversationId: known.id, userId: u.id })))
          .onConflictDoNothing();
        return c.json((await listFor(c, me, known.id))[0]);
      }
    }
    if (!(await allowKey(c, `chat-new:${me.id}`, 20, 86400)))
      return c.json({ error: "that's a lot of new conversations for one day" }, 429);
    const [conv] = await db
      .insert(conversations)
      .values({ title: group ? input.title || null : null, isGroup: group, pairKey, createdBy: me.id })
      .returning();
    await db
      .insert(conversationMembers)
      .values([me, ...people].map((u) => ({ conversationId: conv!.id, userId: u.id })));
    if (group) await post(c, conv!, null, "system", `${me.displayName} started a group with ${names(people)}`);
    return c.json((await listFor(c, me, conv!.id))[0], 201);
  })
  .get("/users/:id/chats/:cid/messages", async (c) => {
    const me = await memberOf(c);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    const before = positiveId(c.req.query("before"));
    const rows = await c
      .get("db")
      .select({ m: messages, u: users })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(and(eq(messages.conversationId, conv.id), before ? lt(messages.id, before) : undefined))
      .orderBy(desc(messages.id))
      .limit(PAGE);
    return c.json(rows.reverse().map((r) => toMessage(r.m, r.u)));
  })
  .post("/users/:id/chats/:cid/messages", json(chatMessageInput), async (c) => {
    const me = await memberOf(c, true);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    if (!conv.isGroup) {
      const others = (await memberIds(c, conv.id)).filter((id) => id !== me.id);
      if (await blockedBetween(c, me.id, others)) return c.json({ error: "you can't message them" }, 403);
    }
    if (!(await allowKey(c, `chat-msg:${me.id}`, 60, 600))) return c.json({ error: "slow down a little" }, 429);
    return c.json(await post(c, conv, me, "text", c.req.valid("json").body), 201);
  })
  /** A BUZZ!!! in a conversation: everyone in it gets their screen shaken. */
  .post("/users/:id/chats/:cid/buzz", async (c) => {
    const me = await memberOf(c, true);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    if (!conv.isGroup) {
      const others = (await memberIds(c, conv.id)).filter((id) => id !== me.id);
      if (await blockedBetween(c, me.id, others)) return c.json({ error: "you can't message them" }, 403);
    }
    if (!(await allowKey(c, `chat-buzz:${me.id}`, 6, 600))) return c.json({ error: "enough BUZZing for now" }, 429);
    return c.json(await post(c, conv, me, "buzz", "BUZZ!!!"), 201);
  })
  .post("/users/:id/chats/:cid/read", async (c) => {
    const me = await memberOf(c);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    await c
      .get("db")
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, me.id)));
    return c.json({ ok: true });
  })
  /** Anyone in a group can bring more people in. */
  .post("/users/:id/chats/:cid/people", json(addToChatInput), async (c) => {
    const me = await memberOf(c, true);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    if (!conv.isGroup) return c.json({ error: "start a group to talk with more people" }, 400);
    const already = await memberIds(c, conv.id);
    const people = (await peopleNamed(c, c.req.valid("json").with, me.id)).filter((p) => !already.includes(p.id));
    if (people.length === 0) return c.json({ error: "they're already here, or there's no one by that name" }, 404);
    if (already.length + people.length > MAX_GROUP)
      return c.json({ error: `a group holds ${MAX_GROUP} people at most` }, 400);
    if (
      await blockedBetween(
        c,
        me.id,
        people.map((p) => p.id),
      )
    )
      return c.json({ error: "you can't add someone you've blocked, or who blocked you" }, 403);
    await c
      .get("db")
      .insert(conversationMembers)
      .values(people.map((u) => ({ conversationId: conv.id, userId: u.id })));
    await post(c, conv, null, "system", `${me.displayName} added ${names(people)}`);
    return c.json((await listFor(c, me, conv.id))[0]);
  })
  .post("/users/:id/chats/:cid/leave", async (c) => {
    const me = await memberOf(c);
    if (me instanceof Response) return me;
    const conv = await ownConversation(c, me.id);
    if (!conv) return c.json({ error: "not found" }, 404);
    if (!conv.isGroup) return c.json({ error: "a conversation between two can't be left; block them instead" }, 400);
    const db = c.get("db");
    await db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, me.id)));
    if ((await memberIds(c, conv.id)).length === 0) await db.delete(conversations).where(eq(conversations.id, conv.id));
    else await post(c, conv, null, "system", `${me.displayName} left`);
    return c.json({ ok: true });
  })
  /** `on: true` stops a member messaging this one (and this one them); `false` lets them again. */
  .post("/users/:id/blocks", json(blockInput), async (c) => {
    const me = await memberOf(c);
    if (me instanceof Response) return me;
    const { handle, on } = c.req.valid("json");
    const [them] = await peopleNamed(c, [handle], me.id);
    if (!them) return c.json({ error: "not found" }, 404);
    const db = c.get("db");
    if (on) await db.insert(blocks).values({ blockerId: me.id, blockedId: them.id }).onConflictDoNothing();
    else await db.delete(blocks).where(and(eq(blocks.blockerId, me.id), eq(blocks.blockedId, them.id)));
    return c.json({ ok: true });
  });
