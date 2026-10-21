import { MAX_TOPICS, PUBLIC_TOPIC, readTicket } from "@4me/shared";

/**
 * The topics a browser may listen to, from the connection URL: public ones as `?t=…` (entry:12, guest:lan,
 * tonight), and its own notifications only with `?ticket=` signed by the web server. Null when anything is off.
 */
export async function vetTopics(url: URL, secret: string, now = Date.now()): Promise<string[] | null> {
  const wanted = url.searchParams.getAll("t");
  if (wanted.length > MAX_TOPICS || wanted.some((t) => !PUBLIC_TOPIC.test(t))) return null;
  const topics = [...new Set(wanted)];
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const uid = await readTicket("live", ticket, secret, now);
    if (!uid) return null;
    topics.push(`user:${uid}`);
  }
  return topics.length > 0 ? topics : null;
}
