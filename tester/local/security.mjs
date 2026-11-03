// Security checks. Locally (everything): the server token, CORS, photo uploads (tickets, types, sizes, metadata),
// photo paths, the live socket, script injection everywhere user words are shown, odd query input.
// On production (PROD=1), only reads or requests that are refused: headers, CORS, closed doors.
import { readFileSync } from "node:fs";
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, recorder, sleep } from "../e2e/lib.mjs";
import { API, api, internal, makeMember, SITE, signInUi, writePage } from "./lib.mjs";

const r = recorder("local-security");
const ts = Date.now().toString(36).slice(-6);
const PHOTO = readFileSync(new URL("../fixtures/photo.jpg", import.meta.url));

await r.step("SEC-01", "the server token guards /internal and /admin", async () => {
  const out = {};
  for (const [label, headers] of [
    ["no token", {}],
    ["wrong token", { authorization: "Bearer wrong" }],
    ["token without Bearer", { authorization: process.env.LOCAL_ADMIN_TOKEN }],
  ]) {
    out[label] = {
      internal: (await api(`/internal/users/1`, { headers })).status,
      admin: (await api(`/admin/errors`, { headers })).status,
    };
  }
  r.check("SEC-01", "every call without the exact bearer token gets 401", Object.values(out).every((x) => x.internal === 401 && x.admin === 401), out);
});

await r.step("SEC-02", "CORS answers only the site's origin", async () => {
  const good = await api(`/entries?limit=1`, { origin: SITE });
  const evil = await api(`/entries?limit=1`, { origin: "https://evil.example" });
  const http = await api(`/entries?limit=1`, { origin: "http://4me.example" });
  const pre = await fetch(`${API}/entries/1/notes`, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  r.check("SEC-02", "the site gets Access-Control-Allow-Origin, others don't", good.headers.get("access-control-allow-origin") === SITE && !evil.headers.get("access-control-allow-origin") && !http.headers.get("access-control-allow-origin") && !pre.headers.get("access-control-allow-origin"), {
    good: good.headers.get("access-control-allow-origin"),
    evil: evil.headers.get("access-control-allow-origin"),
    preflight: pre.headers.get("access-control-allow-origin"),
  });
});

const M = await makeMember("sec");
const BM = await browser();
await signInUi(BM.page, M);
const ids = await discoverActions(BM.page);
const asM = (n, ...a) => action(BM.page, ids, n, ...a);

await r.step("SEC-03", "photo uploads: tickets, types, sizes, metadata", async () => {
  const ticket = (await asM("uploadTicket")).value?.ticket;
  const liveTicket = (await asM("liveTicket")).value;
  const up = (body, t, type = "image/jpeg") =>
    fetch(`${API}/uploads`, { method: "POST", headers: { origin: SITE, "content-type": type, ...(t ? { "x-upload-ticket": t } : {}) }, body });
  const forged = ticket ? ticket.replace(/\.(\d+)\./, (_, uid) => `.${Number(uid) + 1}.`) : "x";
  const res = {
    noTicket: (await up(PHOTO)).status,
    forgedOtherMember: (await up(PHOTO, forged)).status,
    liveTicketAsUpload: (await up(PHOTO, liveTicket ?? "x")).status,
    pngAsJpeg: (await up(Buffer.from("\x89PNG\r\n\x1a\nnot really"), ticket)).status,
    htmlAsJpeg: (await up(Buffer.from("<html><script>alert(1)</script>"), ticket)).status,
    wrongType: (await up(PHOTO, ticket, "text/html")).status,
    tooBig: (await up(Buffer.concat([PHOTO, Buffer.alloc(4 * 1024 * 1024)]), ticket)).status,
  };
  r.check("SEC-03", "no/forged/wrong-purpose ticket 401; non-JPEG 415; over 4 MB 413", res.noTicket === 401 && res.forgedOtherMember === 401 && res.liveTicketAsUpload === 401 && res.pngAsJpeg === 415 && res.htmlAsJpeg === 415 && res.wrongType === 415 && res.tooBig === 413, res);
  // A JPEG carrying an EXIF block with a GPS marker and a comment with script: both must be stripped.
  const marker = Buffer.from(`Exif\0\0QA-GPS-MARKER-${ts}`);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (marker.length + 2) >> 8, (marker.length + 2) & 0xff]), marker]);
  const comment = Buffer.from(`<script>QA-COMMENT-${ts}</script>`);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
  const dirty = Buffer.concat([PHOTO.subarray(0, 2), app1, com, PHOTO.subarray(2)]);
  const ok = await up(dirty, ticket);
  const body = await ok.json();
  const stored = Buffer.from(await (await fetch(body.url)).arrayBuffer());
  const served = await fetch(body.url);
  r.check("SEC-03b", "a photo's EXIF/GPS and comments are stripped before storing", ok.status === 201 && !stored.includes(`QA-GPS-MARKER-${ts}`) && !stored.includes(`QA-COMMENT-${ts}`), {
    status: ok.status,
    gpsLeft: stored.includes(`QA-GPS-MARKER-${ts}`),
    commentLeft: stored.includes(`QA-COMMENT-${ts}`),
    type: served.headers.get("content-type"),
    nosniff: served.headers.get("x-content-type-options"),
    csp: served.headers.get("content-security-policy"),
  });
  const other = await makeMember("sec2");
  const steal = await internal(`/users/${other.id}/entries`, { method: "POST", body: { title: "using someone's photo", body: "x", photos: [{ url: body.path }] } });
  r.check("SEC-03c", "another member can't put this member's photo on their page", steal.status === 400, steal.json);
});

await r.step("SEC-04", "photo paths", async () => {
  const codes = {};
  for (const p of ["/media/u/1/../../internal/users/1", "/media/u/abc/x.jpg", "/media/u/1/..%2f..%2fx.jpg", "/media/u/1/x.png", "/media/u/99999/aaaaaaaa.jpg"])
    codes[p] = (await api(p)).status;
  r.check("SEC-04", "odd or missing photo paths are 404", Object.values(codes).every((c) => c === 404), codes);
});

await r.step("SEC-05", "the live socket", async () => {
  const open = (url, origin) =>
    new Promise((ok) => {
      let ws;
      try {
        ws = new WebSocket(url, origin ? { headers: { origin } } : undefined);
      } catch (e) {
        return ok(`throw ${e.message}`);
      }
      const t = setTimeout(() => {
        ws.close();
        ok("open (timeout)");
      }, 3000);
      ws.onopen = () => {
        clearTimeout(t);
        ws.close();
        ok("open");
      };
      ws.onerror = () => {
        clearTimeout(t);
        ok("refused");
      };
    });
  const base = API.replace(/^http/, "ws");
  const res = {
    noOrigin: await open(`${base}/live?t=tonight`),
    evilOrigin: await open(`${base}/live?t=tonight`, "https://evil.example"),
    ok: await open(`${base}/live?t=tonight`, SITE),
    userTopicWithoutTicket: await open(`${base}/live?t=user:1`, SITE),
    forgedTicket: await open(`${base}/live?ticket=v1.live.1.9999999999999.forged`, SITE),
  };
  r.check("SEC-05", "only the site may connect, and only to public topics without a ticket", res.ok === "open" && res.noOrigin === "refused" && res.evilOrigin === "refused" && res.userTopicWithoutTicket === "refused" && res.forgedTicket === "refused", res);
});

await r.step("SEC-06", "script injection wherever members' and guests' words are shown", async () => {
  const P = `<img src=x onerror="window.__qa=1"><script>window.__qa=2</script><svg onload="window.__qa=3">`;
  const page = await writePage(M, {
    title: `T ${P}`.slice(0, 140),
    body: [`p ${P}`, `> note ${P}`, `| quote ${P}`, `— ${P}`, `[x](javascript:window.__qa=4) [y](data:text/html,<script>window.__qa=5</script>) [z](https://ok.example" onmouseover="window.__qa=6)`, `[photo 99]`, `~~${P}~~ _${P}_`].join("\n\n"),
    mood: `m ${P}`.slice(0, 40),
    weather: `w ${P}`.slice(0, 60),
  });
  await api(`/entries/${page.id}/notes`, { method: "POST", body: { name: "Guest", body: `note ${P}` } });
  await api(`/guestbook`, { method: "POST", body: { name: "Guest", body: `shout ${P}`.slice(0, 280), owner: M.handle } });
  await asM("addBlast", `blast ${P}`.slice(0, 140));
  await asM("addAlmost", `almost ${P}`.slice(0, 280));
  await asM("updateProfile", { bio: `bio ${P}`.slice(0, 160) });
  await api(`/nights/lines`, { method: "POST", body: { name: "Guest", body: `line ${P}`.slice(0, 140) } });
  const other = await makeMember("sec3");
  const chat = (await asM("startChat", [other.handle])).value.chat;
  await asM("sendChat", chat.id, `chat ${P}`);
  const G = await browser();
  const visits = [`/u/${M.handle}/${page.slug}`, `/u/${M.handle}?open=guest`, `/u/${M.handle}`, `/`];
  const fired = {};
  for (const v of visits) {
    await G.page.goto(`${SITE}${v}`, 3500);
    await G.page.eval(`document.querySelectorAll("a").forEach(a => a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))`);
    fired[v] = await G.page.eval(`window.__qa ?? null`);
  }
  await BM.page.goto(`${SITE}/`, 2500);
  await BM.page.clickText("Messenger", "button, a").catch(() => null);
  await sleep(2000);
  await BM.page.clickText(other.displayName, "button, li, a").catch(() => null);
  await sleep(1500);
  fired.messenger = await BM.page.eval(`window.__qa ?? null`);
  const links = await G.page.eval(`[...document.querySelectorAll("a")].map(a => a.getAttribute("href")).filter(h => /^(javascript|data):/i.test(h ?? ""))`);
  r.check("SEC-06", "no injected script runs anywhere (page, notes, guestbook, blast, bin, bio, poem, Messenger)", Object.values(fired).every((v) => v === null) && links.length === 0, { fired, dangerousLinks: links });
  await G.close();
});

await r.step("SEC-07", "odd input in queries", async () => {
  const res = {
    sqlAuthor: (await api(`/entries?author=${encodeURIComponent("' OR 1=1 --")}`)).json,
    sqlSearch: (await api(`/search?q=${encodeURIComponent("'; drop table users; --")}`)).status,
    percent: (await api(`/search?q=${encodeURIComponent("%_%")}`)).json?.pages?.length,
    hugeLimit: (await api(`/entries?limit=1e9`)).json?.length,
    badBefore: (await api(`/entries?before=not-a-date`)).status,
    badPrompt: (await api(`/entries?prompt=2026-13-99`)).status,
    badNight: (await api(`/nights/../../internal/sky`)).status,
    negativeId: (await api(`/entries/-1/notes`)).status,
    bigId: (await api(`/entries/99999999999999/notes`)).status,
    badJson: (await api(`/entries/1/notes`, { method: "POST", body: "{not json" })).status,
  };
  const healthy = (await api(`/health`)).status;
  r.check("SEC-07", "odd input is answered politely (no 500s), and the API is still up", Array.isArray(res.sqlAuthor) && res.sqlAuthor.length === 0 && res.sqlSearch === 200 && res.badBefore === 200 && res.badJson === 400 && healthy === 200 && ![res.negativeId, res.bigId, res.badNight].includes(500), res);
});

await r.step("SEC-08", "server actions without a session do nothing", async () => {
  const G = await browser();
  await G.page.goto(`${SITE}/`, 1500);
  const gids = await discoverActions(G.page);
  const calls = {
    saveEntry: (await action(G.page, gids, "saveEntry", null, { title: "x", body: "x" })).value,
    deleteEntry: (await action(G.page, gids, "deleteEntry", 1)).value,
    sendChat: (await action(G.page, gids, "sendChat", 1, "x")).value,
    uploadTicket: (await action(G.page, gids, "uploadTicket")).value,
    liveTicket: (await action(G.page, gids, "liveTicket")).value,
    myEntries: (await action(G.page, gids, "myEntries")).value,
    exportDiary: (await action(G.page, gids, "exportDiary")).value,
  };
  r.check("SEC-08", "every member action answers 'signed out' or nothing to a guest", Object.values(calls).every((v) => v === null || (Array.isArray(v) && v.length === 0) || v?.ok === false), calls);
  await G.close();
});

await r.step("SEC-09", "security headers on the site and the API (local)", async () => {
  const page = await fetch(`${SITE}/`);
  const apiRes = await fetch(`${API}/health`);
  const pick = (h, names) => Object.fromEntries(names.map((n) => [n, h.get(n)]));
  r.info("SEC-09", "headers", {
    site: pick(page.headers, ["content-security-policy", "strict-transport-security", "x-content-type-options", "referrer-policy", "x-frame-options", "permissions-policy"]),
    api: pick(apiRes.headers, ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "cross-origin-resource-policy"]),
  });
});

r.info("SEC-99", "browser problems", BM.page.problems.slice(0, 10));
r.save();
await BM.close();
