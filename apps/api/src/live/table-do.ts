import { DurableObject } from "cloudflare:workers";
import { readTicket, type Seat, type Table, type TableEvent, type TableListing } from "@4me/shared";
import type { Bindings } from "../env";
import { type Conn, TableRoom, type Unlock } from "./table";

// Werewolf tables on Workers: one Durable Object per table, close to whoever opened it, holding its players'
// WebSockets with the hibernation API (it sleeps between moves and still wakes for the clock, with an alarm). A
// second, single object keeps the list of open tables for the desktop.

/** Who a socket is, and until when they're known to be signed in (a fresh ticket moves it on). */
type Attachment = { uid: number; until?: number };

export class GameTable extends DurableObject<Bindings> {
  private room: TableRoom;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.room = new TableRoom(
      {
        conns: () => this.conns(),
        load: async () => (await ctx.storage.get<Table>("table")) ?? null,
        save: async (t) => {
          if (t) await ctx.storage.put("table", t);
          else {
            await ctx.storage.deleteAlarm();
            await ctx.storage.deleteAll();
          }
        },
        schedule: (at) => ctx.storage.setAlarm(at),
        list: async (code, l) => {
          const lobby = env.TABLE_LOBBY;
          if (!lobby) return;
          await lobby
            .get(lobby.idFromName("lobby"))
            .fetch("https://lobby/put", { method: "POST", body: JSON.stringify({ code, listing: l }) });
        },
        renew: (uid, until) => {
          for (const ws of ctx.getWebSockets()) {
            const a = ws.deserializeAttachment() as Attachment | null;
            if (a?.uid === uid) ws.serializeAttachment({ uid, until } satisfies Attachment);
          }
        },
      },
      undefined,
      undefined,
      (ticket) => readTicket("live", ticket, env.ADMIN_TOKEN),
    );
  }

  private conns(except?: WebSocket): Conn[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except)
      .map((ws) => {
        const a = ws.deserializeAttachment() as Attachment | null;
        return {
          uid: a?.uid ?? 0,
          until: a?.until,
          send: (d: string) => ws.send(d),
          close: (code: number, reason: string) => ws.close(code, reason),
        };
      });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/create" && req.method === "POST") {
      const { code, seat } = (await req.json()) as { code: string; seat: Seat };
      return (await this.room.create(code, seat)) ? new Response("ok") : new Response("taken", { status: 409 });
    }
    if (url.pathname === "/unlock" && req.method === "POST") {
      const { uid, password } = (await req.json()) as { uid: number; password: string };
      return Response.json({ result: await this.room.unlock(uid, password) });
    }
    if (url.pathname === "/connect") {
      // The Worker checked who this is.
      const seat = JSON.parse(req.headers.get("x-seat") ?? "null") as Seat | null;
      if (!seat) return new Response("who?", { status: 400 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ uid: seat.id } satisfies Attachment);
      const err = await this.room.join(seat);
      if (err) {
        server.send(JSON.stringify({ t: "closed", reason: err.error } satisfies TableEvent));
        server.close(4003, err.error.slice(0, 100));
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const uid = (ws.deserializeAttachment() as Attachment | null)?.uid;
    if (!uid || typeof message !== "string") return;
    await this.room.message(uid, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const uid = (ws.deserializeAttachment() as Attachment | null)?.uid;
    if (uid) await this.room.closed(uid, this.conns(ws));
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    const uid = (ws.deserializeAttachment() as Attachment | null)?.uid;
    if (uid) await this.room.closed(uid, this.conns(ws));
  }

  async alarm() {
    await this.room.alarm();
  }
}

/** The open tables, for the desktop's list. Each table tells it when it changes. */
export class TableLobby extends DurableObject<Bindings> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/put" && req.method === "POST") {
      const { code, listing } = (await req.json()) as { code: string; listing: TableListing | null };
      if (listing) await this.ctx.storage.put(`t:${code}`, listing);
      else await this.ctx.storage.delete(`t:${code}`);
      return new Response("ok");
    }
    if (url.pathname === "/list") {
      const all = await this.ctx.storage.list<TableListing>({ prefix: "t:" });
      const now = Date.now();
      const stale = [...all].filter(([, l]) => now - l.updatedAt > 6 * 3600_000).map(([k]) => k);
      if (stale.length) await this.ctx.storage.delete(stale);
      const open = [...all.values()].filter((l) => now - l.updatedAt <= 6 * 3600_000);
      return Response.json(open);
    }
    return new Response("not found", { status: 404 });
  }
}

/** The tables, as the API's routes use them, on Workers. */
export function durableTables(tables: DurableObjectNamespace, lobby: DurableObjectNamespace | undefined) {
  const table = (code: string) => tables.get(tables.idFromName(code));
  return {
    async create(code: string, host: Seat) {
      const res = await table(code).fetch("https://table/create", {
        method: "POST",
        body: JSON.stringify({ code, seat: host }),
      });
      return res.ok;
    },
    async list(): Promise<TableListing[]> {
      if (!lobby) return [];
      return (await lobby.get(lobby.idFromName("lobby")).fetch("https://lobby/list")).json();
    },
    async unlock(code: string, uid: number, password: string): Promise<Unlock> {
      const res = await table(code).fetch("https://table/unlock", {
        method: "POST",
        body: JSON.stringify({ uid, password }),
      });
      return res.ok ? ((await res.json()) as { result: Unlock }).result : "gone";
    },
    connect(code: string, req: Request, seat: Seat) {
      const headers = new Headers(req.headers);
      headers.set("x-seat", JSON.stringify(seat));
      return table(code).fetch("https://table/connect", { headers });
    },
  };
}
