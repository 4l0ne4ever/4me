import type { Instrumentation } from "next";

export function register() {
  // nothing to set up; Next asks for this file's onRequestError below
}

/**
 * Any error while the web server draws a page or runs an action is sent to the API's error log (the moderator sees
 * it in /admin and in the morning summary). Only the message, where in the code, and the route: never the request.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const token = process.env.ADMIN_TOKEN;
  if (!api || !token) return;
  const e = err as Error & { digest?: string };
  // Next's own "not found" and redirects travel as errors; they are not mistakes.
  if (e.digest?.startsWith("NEXT_")) return;
  const detail = (e.stack ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("at "))
    .slice(0, 12)
    .join("\n");
  try {
    await fetch(`${api}/internal/errors`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        source: "web",
        message: `${e.name ?? "Error"}: ${String(e.message ?? "unknown")
          .split(/params:/)[0]!
          .slice(0, 900)}`,
        detail,
        path: `${context.routeType} ${context.routePath}`,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // the log is down too; nothing more to do
  }
  void request;
};
