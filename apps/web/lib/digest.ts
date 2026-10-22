import "server-only";
import { sessionSecret, siteUrl } from "./auth";
import { unsubscribeToken } from "./crypto";

/** The two ways out of the morning email: a page with a button, and the one-click link mail apps POST to. */
export function stopLinks(uid: number) {
  const q = `u=${uid}&t=${unsubscribeToken(uid, sessionSecret())}`;
  return { page: `${siteUrl()}/unsubscribe?${q}`, oneClick: `${siteUrl()}/api/unsubscribe?${q}` };
}
