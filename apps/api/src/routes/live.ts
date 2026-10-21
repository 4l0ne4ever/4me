import { Hono } from "hono";
import type { AppEnv } from "../env";
import { allow } from "../lib/guard";
import { vetTopics } from "../live/vet";

const allowedOrigin = (origin: string, list: string) =>
  list
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .includes(origin);

/** The live connection: a WebSocket that receives notes, shouts, BUZZes, new pages and the member's notifications. */
export const liveRoutes = new Hono<AppEnv>().get("/live", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "expected a WebSocket" }, 426);
  // Only the diary's own pages may open one (other sites would only see public things, but there's no reason to).
  if (!allowedOrigin(c.req.header("origin") ?? "", c.env.WEB_ORIGIN ?? "")) return c.json({ error: "forbidden" }, 403);
  if (!(await allow(c, "live", 60, 60))) return c.json({ error: "too many connections, wait a moment" }, 429);
  const topics = await vetTopics(new URL(c.req.url), c.env.ADMIN_TOKEN);
  if (!topics) return c.json({ error: "nothing to listen to" }, 400);
  const live = c.get("live");
  if (!live?.connect) return c.json({ error: "live updates aren't available here" }, 501);
  return live.connect(c.req.raw, topics);
});
