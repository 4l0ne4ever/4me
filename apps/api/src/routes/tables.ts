import { avatarUrl, readTicket, type Seat, TABLE_CODE, type TableListing, tablePassword } from "@4me/shared";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { users } from "../db/schema";
import type { AppEnv } from "../env";
import { positiveId } from "../lib/entries";
import { allow, allowKey, sameSecret } from "../lib/guard";

// Werewolf tables. Members open one from the desktop (through the web server, like everything a member does), and
// each player's browser connects straight to it with a short ticket the web server signed. The voice goes between
// the players' browsers (WebRTC); the table only passes their handshakes along and says who may hear whom.

/** Everything about the tables an API route needs: on Workers, Durable Objects; in development, memory. */
export interface Tables {
  create(code: string, host: Seat): Promise<boolean>;
  list(): Promise<TableListing[]>;
  /** Checks a table's password for a member; "ok" lets them sit down. */
  unlock(code: string, uid: number, password: string): Promise<"ok" | "open" | "wrong" | "gone">;
  /** Hands a browser's WebSocket upgrade to the table (Workers; development wires sockets itself). */
  connect?(code: string, req: Request, seat: Seat): Promise<Response>;
}

const allowedOrigin = (origin: string, list: string) =>
  list
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .includes(origin);

/** Who a member is at the table, or null when they can't sit down (unknown, or suspended). */
export async function seatOf(c: Context<AppEnv>, uid: number): Promise<Seat | null> {
  const [u] = await c
    .get("db")
    .select({ id: users.id, name: users.displayName, handle: users.handle, avatar: users.avatar })
    .from(users)
    .where(and(eq(users.id, uid), eq(users.status, "active")))
    .limit(1);
  if (!u?.handle) return null;
  return { id: u.id, name: u.name, handle: u.handle, avatar: avatarUrl(u.avatar) };
}

/** Six letters and digits, without the ones that are easy to misread. */
function newCode(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

/** What a browser needs to reach another (the shape RTCPeerConnection takes). */
type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** STUN always; TURN (Cloudflare's, for players behind strict networks) when its key is configured. */
async function iceServers(c: Context<AppEnv>): Promise<IceServer[]> {
  const stun: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  const { TURN_KEY_ID: id, TURN_KEY_API_TOKEN: token } = c.env;
  if (!id || !token) return stun;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: 4 * 3600 }),
    });
    if (!res.ok) return stun;
    const data = (await res.json()) as { iceServers?: IceServer[] | IceServer };
    const turn = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return turn.length ? turn : stun;
  } catch {
    return stun;
  }
}

/** Open to browsers: the list of open tables, and the connection to one. */
export const tableRoutes = new Hono<AppEnv>()
  .get("/tables", async (c) => {
    const tables = c.get("tables");
    const list = tables ? await tables.list() : [];
    c.header("cache-control", "public, max-age=5");
    return c.json(
      list
        .filter((l) => l.phase !== "over")
        .sort((a, b) => Number(b.phase === "lobby") - Number(a.phase === "lobby") || b.updatedAt - a.updatedAt)
        .slice(0, 30),
    );
  })
  .get("/tables/:code/ws", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "expected a WebSocket" }, 426);
    if (!allowedOrigin(c.req.header("origin") ?? "", c.env.WEB_ORIGIN ?? ""))
      return c.json({ error: "forbidden" }, 403);
    const code = c.req.param("code");
    if (!TABLE_CODE.test(code)) return c.json({ error: "no such table" }, 404);
    if (!(await allow(c, "table-ws", 40, 60))) return c.json({ error: "too many connections, wait a moment" }, 429);
    const uid = await readTicket("live", c.req.query("ticket") ?? "", c.env.ADMIN_TOKEN);
    if (!uid) return c.json({ error: "sign in again" }, 401);
    const seat = await seatOf(c, uid);
    if (!seat) return c.json({ error: "this account can't play right now" }, 403);
    const tables = c.get("tables");
    if (!tables?.connect) return c.json({ error: "tables aren't available here" }, 501);
    return tables.connect(code, c.req.raw, seat);
  });

/** For the web server only (the same bearer token as /internal). */
export const tableInternalRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !(await sameSecret(token, c.env.ADMIN_TOKEN))) return c.json({ error: "unauthorised" }, 401);
    await next();
  })
  /** A member opens a new table and sits at it. */
  .post("/users/:id/tables", async (c) => {
    const uid = positiveId(c.req.param("id"));
    const seat = uid ? await seatOf(c, uid) : null;
    if (!seat) return c.json({ error: "this account can't play right now" }, 403);
    const tables = c.get("tables");
    if (!tables) return c.json({ error: "tables aren't available here" }, 501);
    if (!(await allowKey(c, `table-open:${seat.id}`, 12, 3600)))
      return c.json({ error: "that's a lot of tables for one hour" }, 429);
    for (let i = 0; i < 3; i++) {
      const code = newCode();
      if (await tables.create(code, seat)) return c.json({ code }, 201);
    }
    return c.json({ error: "couldn't open a table, try again" }, 503);
  })
  /** A member gives a table's password. Few tries, so a short password can't be guessed by trying them all. */
  .post("/users/:id/tables/:code/unlock", async (c) => {
    const uid = positiveId(c.req.param("id"));
    const code = c.req.param("code");
    const seat = uid ? await seatOf(c, uid) : null;
    if (!seat) return c.json({ error: "this account can't play right now" }, 403);
    if (!TABLE_CODE.test(code)) return c.json({ error: "no such table" }, 404);
    const body = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
    const password = tablePassword.safeParse(body?.password);
    if (!password.success) return c.json({ error: "that's not the password" }, 400);
    const tables = c.get("tables");
    if (!tables) return c.json({ error: "tables aren't available here" }, 501);
    if (!(await allowKey(c, `table-unlock:${seat.id}`, 10, 600)))
      return c.json({ error: "too many tries; wait a few minutes" }, 429);
    const result = await tables.unlock(code, seat.id, password.data);
    if (result === "gone") return c.json({ error: "this table has been put away" }, 404);
    if (result === "wrong") return c.json({ error: "that's not the password" }, 403);
    return c.json({ ok: true });
  })
  /** How browsers find each other for the voice: short-lived, so asked for each time someone sits down. */
  .get("/tables/ice", async (c) => c.json({ iceServers: await iceServers(c) }));
