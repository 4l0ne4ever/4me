import { getMe, publicMe } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Who is signed in. Fetched by the desktop after it renders, so pages themselves stay cacheable. */
export async function GET() {
  const me = await getMe();
  return Response.json(me ? publicMe(me) : null, { headers: { "cache-control": "private, no-store" } });
}
