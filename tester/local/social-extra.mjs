// Two checks re-run from social.mjs with the right expectations: taking a reaction back (kind null, as the page
// sends it), and "a year ago tonight" for a member who still has pages left today.
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, recorder } from "../e2e/lib.mjs";
import { api, makeMember, newIp, signInUi, writePage } from "./lib.mjs";

const r = recorder("local-social-extra");
const W = await makeMember("yr");
const p = await writePage(W, { title: "React here" });
const ip = newIp();
await api(`/entries/${p.id}/react`, { method: "POST", ip, body: { kind: "love" } });
const changed = (await api(`/entries/${p.id}/react`, { method: "POST", ip, body: { kind: "moon" } })).json;
const back = (await api(`/entries/${p.id}/react`, { method: "POST", ip, body: { kind: null } })).json;
r.check("S-03", "a visitor's reaction: love then moon leaves one moon; null takes it back", JSON.stringify(changed.reactions) === '{"moon":1}' && JSON.stringify(back.reactions) === "{}", { changed, back });

const B = await browser();
await signInUi(B.page, W);
const ids = await discoverActions(B.page);
const yearAgo = new Date(Date.now() - 365 * 86400_000);
const monthAgo = new Date(Date.now() - 30 * 86400_000);
await writePage(W, { title: "Last year", writtenAt: yearAgo.toISOString(), visibility: "private" });
await writePage(W, { title: "Draft last year", writtenAt: yearAgo.toISOString(), visibility: "draft" });
await writePage(W, { title: "Last month", writtenAt: monthAgo.toISOString() });
const then = (await action(B.page, ids, "onThisNight")).value;
r.check("S-16", "this night a year ago comes back (drafts don't)", then?.year?.some((x) => x.title === "Last year") && !then?.year?.some((x) => x.title === "Draft last year"), then);
r.info("S-16b", "a month ago (README: 'or, for now, a month ago')", then?.month);
r.save();
await B.close();
