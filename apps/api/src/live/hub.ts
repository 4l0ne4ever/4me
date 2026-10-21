import { DurableObject } from "cloudflare:workers";
import type { LiveEvent } from "@4me/shared";
import type { Bindings } from "../env";

/**
 * Everyone's live connection, in one Durable Object. Each WebSocket is tagged with its topics when it joins, so a
 * broadcast is a lookup by tag. It uses the hibernation API: while nobody is sending anything the object sleeps,
 * and pings are answered without waking it.
 */
export class Hub extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      // The Worker already checked the topics (and the ticket for a member's own notifications).
      const topics = (JSON.parse(req.headers.get("x-topics") ?? "[]") as string[]).slice(0, 10);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server, topics);
      server.send(JSON.stringify({ type: "hello" } satisfies LiveEvent));
      for (const t of topics) if (t.startsWith("entry:")) this.presence(t);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/publish" && req.method === "POST") {
      const { topics, event } = (await req.json()) as { topics: string[]; event: LiveEvent };
      this.send(topics, event);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  private send(topics: string[], event: LiveEvent, except?: WebSocket) {
    const msg = JSON.stringify(event);
    const done = new Set<WebSocket>();
    for (const t of topics) {
      for (const ws of this.ctx.getWebSockets(t)) {
        if (ws === except || done.has(ws)) continue;
        done.add(ws);
        try {
          ws.send(msg);
        } catch {
          // closing; the close handler tidies up
        }
      }
    }
  }

  private presence(topic: string, leaving?: WebSocket) {
    const reading = this.ctx.getWebSockets(topic).filter((ws) => ws !== leaving).length;
    this.send([topic], { type: "presence", entryId: Number(topic.slice("entry:".length)), reading }, leaving);
  }

  private gone(ws: WebSocket) {
    for (const t of this.ctx.getTags(ws)) if (t.startsWith("entry:")) this.presence(t, ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.gone(ws);
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }
}

/** The Live interface on Workers: everything goes through the one Hub object. */
export function hubLive(ns: DurableObjectNamespace) {
  const hub = () => ns.get(ns.idFromName("hub"));
  return {
    async publish(topics: string[], event: LiveEvent) {
      await hub().fetch("https://hub/publish", { method: "POST", body: JSON.stringify({ topics, event }) });
    },
    connect(req: Request, topics: string[]) {
      const headers = new Headers(req.headers);
      headers.set("x-topics", JSON.stringify(topics));
      return hub().fetch("https://hub/connect", { headers });
    },
  };
}
