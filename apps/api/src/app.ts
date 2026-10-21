import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { DB } from "./db/types";
import type { AppEnv, Bindings, Live } from "./env";
import type { MediaStore } from "./lib/media";
import { adminRoutes } from "./routes/admin";
import { archiveRoutes } from "./routes/archive";
import { entryRoutes } from "./routes/entries";
import { internalRoutes } from "./routes/internal";
import { liveRoutes } from "./routes/live";
import { mediaRoutes } from "./routes/media";
import { musicRoutes } from "./routes/music";
import { searchRoutes } from "./routes/search";
import { socialRoutes } from "./routes/social";

/** The whole API, independent of where it runs: Workers + Neon in production, Node + PGlite locally and in tests. */
export function createApp(
  resolveDb: (env: Bindings) => DB,
  resolveMedia: (env: Bindings) => MediaStore | null = () => null,
  resolveLive: (env: Bindings) => Live | null = () => null,
) {
  const app = new Hono<AppEnv>();

  const secure = secureHeaders({
    // Browsers remember to use HTTPS for two years, subdomains included.
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: "same-site",
  });
  // Photos set their own headers: they must be embeddable from the diary's site, which same-site would forbid.
  // A WebSocket upgrade's response can't take extra headers either; /live checks the origin itself.
  const own = (path: string) => path.startsWith("/media/") || path === "/live";
  app.use("*", (c, next) => (own(c.req.path) ? next() : secure(c, next)));
  const sharing = cors({
    origin: (origin, c) => {
      const allowed = (c.env.WEB_ORIGIN ?? "").split(",").map((o: string) => o.trim().replace(/\/+$/, ""));
      // Only HTTPS origins, apart from localhost while developing.
      const secure = origin.startsWith("https://") || /^http:\/\/localhost(:\d+)?$/.test(origin);
      return secure && allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Upload-Ticket"],
    maxAge: 86400,
  });
  app.use("*", (c, next) => (c.req.path === "/live" ? next() : sharing(c, next)));
  app.use("*", async (c, next) => {
    c.set("db", resolveDb(c.env));
    c.set("media", resolveMedia(c.env));
    c.set("live", resolveLive(c.env));
    await next();
  });

  app.route("/entries", entryRoutes);
  app.route("/", mediaRoutes);
  app.route("/", liveRoutes);
  app.route("/", searchRoutes);
  app.route("/", archiveRoutes);
  app.route("/", musicRoutes);
  app.route("/", socialRoutes);
  app.route("/admin", adminRoutes);
  app.route("/internal", internalRoutes);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    // Never log query parameters: they can hold emails and password hashes.
    const message = err instanceof Error ? err.message.split(/\nparams:/)[0] : "unknown error";
    console.error(`${err instanceof Error ? err.name : "Error"}: ${message}`);
    return c.json({ error: "something went wrong" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
