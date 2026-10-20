import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { DB } from "./db/types";
import type { AppEnv, Bindings } from "./env";
import { adminRoutes } from "./routes/admin";
import { entryRoutes } from "./routes/entries";
import { socialRoutes } from "./routes/social";

/** The whole API, independent of where it runs: Workers + Neon in production, Node + PGlite locally and in tests. */
export function createApp(resolveDb: (env: Bindings) => DB) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        const allowed = (c.env.WEB_ORIGIN ?? "").split(",").map((o: string) => o.trim());
        return allowed.includes(origin) ? origin : null;
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );
  app.use("*", async (c, next) => {
    c.set("db", resolveDb(c.env));
    await next();
  });

  app.route("/entries", entryRoutes);
  app.route("/", socialRoutes);
  app.route("/admin", adminRoutes);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "something went wrong" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
