import { desc, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { errorEvents } from "../db/schema";
import type { AppEnv } from "../env";
import { recordError } from "../lib/errors";
import { allowKey } from "../lib/guard";
import { json } from "../lib/validate";

const report = z.object({
  source: z.enum(["web", "browser"]),
  message: z.string().trim().min(1).max(1000),
  detail: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
});

/** Errors the web server saw (its own, and readers' browsers'), and the list for the morning summary. */
export const errorRoutes = new Hono<AppEnv>()
  .post("/errors", json(report), async (c) => {
    const r = c.req.valid("json");
    // Browsers can be made to send anything: a cap on all of them together, so the log can't be flooded.
    if (r.source === "browser" && !(await allowKey(c, "error-report:browser", 120, 3600))) return c.json({ ok: false });
    await recordError(c.get("db"), r);
    return c.json({ ok: true });
  })
  .get("/errors/recent", async (c) => {
    const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 168);
    const rows = await c
      .get("db")
      .select()
      .from(errorEvents)
      .where(gt(errorEvents.lastAt, new Date(Date.now() - hours * 3600_000)))
      .orderBy(desc(errorEvents.count))
      .limit(50);
    return c.json(rows);
  });
