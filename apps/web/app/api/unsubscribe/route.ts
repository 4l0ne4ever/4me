import { internalApi, sessionSecret } from "@/lib/auth";
import { checkUnsubscribe } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** One-click unsubscribe (RFC 8058): the mail app POSTs here from its own "unsubscribe" button. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const uid = Number(url.searchParams.get("u"));
  if (!checkUnsubscribe(uid, url.searchParams.get("t") ?? "", sessionSecret()))
    return new Response("not found", { status: 404 });
  await internalApi(`/users/${uid}/digest-off`, { method: "POST" });
  return new Response("unsubscribed", { status: 200 });
}
