"use client";

import type { ChatMessage, Conversation, Me } from "@4me/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { myChats, readChat, startChat } from "@/lib/chat-actions";
import { useLiveEvent } from "@/lib/live";

/**
 * Private messages belong to the computer, not to a page: the list of conversations, which one is open, and what
 * is unread live here, so a message is heard (a ding, a balloon, the taskbar) wherever the reader is, even with
 * Messenger closed.
 */
type Chat = {
  /** Null until known, and for guests. */
  chats: Conversation[] | null;
  unread: number;
  active: number | null;
  setActive: (id: number | null) => void;
  /** Opens Messenger on a conversation with these people. Returns an error to show, or null. */
  talkTo: (handles: string[], title?: string) => Promise<string | null>;
  /** Puts a conversation (new or changed) in the list. */
  upsert: (chat: Conversation) => void;
  remove: (id: number) => void;
  markRead: (id: number) => void;
};

const ChatContext = createContext<Chat | null>(null);

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("useChat outside ChatProvider");
  return chat;
}

let audio: AudioContext | null = null;
/** Two soft notes, like a messenger in 2006. */
function ding() {
  try {
    audio ??= new AudioContext();
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const at = audio.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      o.connect(g);
      g.connect(audio.destination);
      o.start(at);
      o.stop(at + 0.3);
    }
  } catch {
    // no sound, no problem
  }
}

/** How a conversation is named: the group's name, or the other people in it. */
export function chatName(chat: Conversation, me: Me): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.handle !== me.handle);
  return others.length ? others.map((m) => m.name).join(", ") : "a former reader";
}

export function ChatProvider({
  me,
  shown,
  onOpen,
  onBuzz,
  children,
}: {
  me: Me | null;
  /** Messenger is open and not minimised. */
  shown: boolean;
  onOpen: () => void;
  /** A BUZZ!!! from someone: shake the screen. */
  onBuzz: () => void;
  children: ReactNode;
}) {
  const [chats, setChats] = useState<Conversation[] | null>(null);
  const [active, setActiveState] = useState<number | null>(null);
  const [balloon, setBalloon] = useState<{ chat: Conversation; message: ChatMessage } | null>(null);
  const balloonTimer = useRef(0);
  const view = useRef({ shown, active });
  view.current = { shown, active };

  const reload = useCallback(async () => {
    const list = me ? await myChats() : null;
    setChats(list);
    return list;
  }, [me]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different person signed in starts over
  useEffect(() => {
    setActiveState(null);
    void reload();
  }, [me?.id, reload]);

  const upsert = useCallback(
    (chat: Conversation) =>
      setChats((list) =>
        [chat, ...(list ?? []).filter((c) => c.id !== chat.id)].sort((a, b) =>
          b.lastMessageAt.localeCompare(a.lastMessageAt),
        ),
      ),
    [],
  );
  const remove = useCallback((id: number) => {
    setChats((list) => list?.filter((c) => c.id !== id) ?? null);
    setActiveState((a) => (a === id ? null : a));
  }, []);
  const markRead = useCallback((id: number) => {
    setChats((list) => list?.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c)) ?? null);
    void readChat(id);
  }, []);
  const setActive = useCallback(
    (id: number | null) => {
      setActiveState(id);
      if (id) {
        setBalloon((b) => (b?.chat.id === id ? null : b));
        markRead(id);
      }
    },
    [markRead],
  );
  const talkTo = useCallback(
    async (handles: string[], title?: string) => {
      const res = await startChat(handles, title);
      if (!res.ok) return res.error;
      upsert(res.chat);
      setActive(res.chat.id);
      onOpen();
      return null;
    },
    [onOpen, setActive, upsert],
  );

  /** Someone else said something: a BUZZ shakes the screen; unless it is on screen, a ding and a balloon. */
  const heard = (chat: Conversation, m: ChatMessage, looking: boolean) => {
    if (m.kind === "buzz") onBuzz();
    if (looking) return void readChat(m.conversationId);
    ding();
    setBalloon({ chat, message: m });
    window.clearTimeout(balloonTimer.current);
    balloonTimer.current = window.setTimeout(() => setBalloon(null), 8000);
  };

  useLiveEvent((e) => {
    if (e.type === "hello") return void reload();
    if (e.type !== "message" || !me) return;
    const m = e.message;
    const mine = m.from?.handle === me.handle;
    const looking = view.current.shown && view.current.active === m.conversationId && !document.hidden;
    const known = chats?.find((c) => c.id === m.conversationId);
    if (!known) {
      // A new conversation, or new people in one: the list is asked for again, then the message is heard.
      void reload().then((list) => {
        const chat = list?.find((c) => c.id === m.conversationId);
        if (chat && !mine && m.kind !== "system") heard(chat, m, looking);
      });
      return;
    }
    const unread = mine || m.kind === "system" ? known.unread : looking ? 0 : known.unread + 1;
    const next = { ...known, last: m, lastMessageAt: m.createdAt, unread };
    upsert(next);
    if (!mine && m.kind !== "system") heard(next, m, looking);
  });

  const unread = (chats ?? []).reduce((n, c) => n + c.unread, 0);
  const value: Chat = { chats, unread, active, setActive, talkTo, upsert, remove, markRead };

  return (
    <ChatContext.Provider value={value}>
      {children}
      {balloon && me && (
        <div className="balloon chat-balloon" role="status">
          <button
            type="button"
            className="balloon-body"
            onClick={() => {
              setActive(balloon.chat.id);
              onOpen();
            }}
          >
            {balloon.message.from && <img src={balloon.message.from.avatar} alt="" width={32} height={32} />}
            <span>
              <b>{chatName(balloon.chat, me)}</b>
              {balloon.message.kind === "buzz"
                ? `${balloon.message.from?.name ?? "Someone"} sent a BUZZ!!!`
                : `${balloon.chat.group && balloon.message.from ? `${balloon.message.from.name}: ` : ""}${balloon.message.body}`}
            </span>
          </button>
          <button type="button" className="balloon-x" aria-label="Close" onClick={() => setBalloon(null)}>
            ×
          </button>
        </div>
      )}
    </ChatContext.Provider>
  );
}
