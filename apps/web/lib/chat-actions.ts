"use server";

import { type ChatMessage, type Conversation, chatMessageInput, startChatInput } from "@4me/shared";
import { type Fail, fail, type Ok, signedOut } from "./action-result";
import { getMe, internalApi } from "./auth";

// Private messages. Each action re-reads the session; the API only ever hears which member is asking from here.

export async function myChats(): Promise<Conversation[]> {
  const me = await getMe();
  if (!me) return [];
  try {
    return await internalApi<Conversation[]>(`/users/${me.id}/chats`);
  } catch {
    return [];
  }
}

/** A conversation with these people (by desktop address): the existing one for two, a new one for a group. */
export async function startChat(handles: string[], title?: string): Promise<Ok<{ chat: Conversation }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = startChatInput.safeParse({ with: handles, title: title || undefined });
  if (!input.success) return { ok: false, error: "pick who to talk to (eleven people at most)" };
  try {
    return {
      ok: true,
      chat: await internalApi<Conversation>(`/users/${me.id}/chats`, { method: "POST", body: input.data }),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function chatHistory(chatId: number, before?: number): Promise<ChatMessage[]> {
  const me = await getMe();
  if (!me || !Number.isInteger(chatId)) return [];
  try {
    return await internalApi<ChatMessage[]>(
      `/users/${me.id}/chats/${chatId}/messages${before ? `?before=${before}` : ""}`,
    );
  } catch {
    return [];
  }
}

export async function sendChat(chatId: number, body: string): Promise<Ok<{ message: ChatMessage }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  const input = chatMessageInput.safeParse({ body });
  if (!input.success || !Number.isInteger(chatId))
    return { ok: false, error: "write something first (1000 characters at most)" };
  try {
    return {
      ok: true,
      message: await internalApi<ChatMessage>(`/users/${me.id}/chats/${chatId}/messages`, {
        method: "POST",
        body: input.data,
      }),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function buzzChat(chatId: number): Promise<Ok<{ message: ChatMessage }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    return {
      ok: true,
      message: await internalApi<ChatMessage>(`/users/${me.id}/chats/${chatId}/buzz`, { method: "POST" }),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function readChat(chatId: number): Promise<void> {
  const me = await getMe();
  if (!me || !Number.isInteger(chatId)) return;
  try {
    await internalApi(`/users/${me.id}/chats/${chatId}/read`, { method: "POST" });
  } catch {
    // unread stays unread; nothing else to do
  }
}

export async function addToChat(chatId: number, handles: string[]): Promise<Ok<{ chat: Conversation }> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    return {
      ok: true,
      chat: await internalApi<Conversation>(`/users/${me.id}/chats/${chatId}/people`, {
        method: "POST",
        body: { with: handles },
      }),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function leaveChat(chatId: number): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/chats/${chatId}/leave`, { method: "POST" });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function blockMember(handle: string, on: boolean): Promise<Ok<object> | Fail> {
  const me = await getMe();
  if (!me) return signedOut;
  try {
    await internalApi(`/users/${me.id}/blocks`, { method: "POST", body: { handle, on } });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
