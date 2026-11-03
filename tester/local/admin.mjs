// The moderator's /admin on the local stack, through its real forms: log-on, reported pages and notes, hidden
// pages, members (suspend and restore), held notes and shouts, the error list, planned nights, log-off. Also
// whether its form actions refuse someone without the moderator's cookie, and the morning-email cron's secret.
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, recorder, sleep } from "../e2e/lib.mjs";
import { api, internal, makeMember, SITE, signInUi, writePage } from "./lib.mjs";

const r = recorder("local-admin");
const ts = Date.now().toString(36).slice(-6);
const PASSWORD = process.env.LOCAL_ADMIN_PASSWORD;

const A = await browser();
const page = A.page;
/** Submits the first /admin form whose hidden fields match, the way its button does. */
const submitForm = (match, section) =>
  page.eval(`(() => {
    const want = ${JSON.stringify(match)};
    const forms = [...document.querySelectorAll(${JSON.stringify(section ? `#${section} form` : "form")})];
    const f = forms.find(f => Object.entries(want).every(([k, v]) => f.querySelector('[name="' + k + '"]')?.value === String(v)));
    if (!f) return false;
    f.requestSubmit();
    return true;
  })()`);
const reload = () => page.goto(`${SITE}/admin`, 1200);
const sectionText = (id) => page.text(`#${id}`);

try {
  await r.step("AD-01", "log-on", async () => {
    await page.goto(`${SITE}/admin`, 1200);
    await page.fill("input[name=password]", "not-it");
    await page.eval(`document.querySelector("input[name=password]").closest("form").requestSubmit()`);
    await page.waitFor(`location.search.includes("error")`, 10000);
    const wrong = await page.text("body");
    await page.fill("input[name=password]", PASSWORD);
    await page.eval(`document.querySelector("input[name=password]").closest("form").requestSubmit()`);
    await page.waitFor(`document.querySelector("#reports")`, 15000);
    const cookies = (await page.send("Network.getAllCookies")).cookies.filter((c) => /author/.test(c.name));
    r.check("AD-01", "a wrong password is refused; the right one opens every section", /wrong|password/i.test(wrong), {
      sections: await page.eval(`[...document.querySelectorAll("section[id]")].map(s => s.id)`),
      cookie: cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, sameSite: c.sameSite, expiresInDays: Math.round((c.expires * 1000 - Date.now()) / 86400000) })),
    });
  });

  const W = await makeMember("adw");
  const p = await writePage(W, { title: `Reported ${ts}`, slug: `reported-${ts}` });
  await r.step("AD-02", "a page reported three times: listed, then Keep up", async () => {
    for (const reason of ["spam", "hurtful", "private"]) await api(`/entries/${p.id}/report`, { method: "POST", body: { reason } });
    await reload();
    const listed = (await sectionText("reports")).includes(`Reported ${ts}`);
    const hiddenBefore = (await api(`/entries/by/${W.handle}/${p.slug}`)).status;
    const kept = await submitForm({ id: p.id, status: "visible" }, "reports");
    await sleep(2000);
    await reload();
    const after = (await api(`/entries/by/${W.handle}/${p.slug}?k`)).status;
    const stillListed = (await sectionText("reports")).includes(`Reported ${ts}`);
    await api(`/entries/${p.id}/report`, { method: "POST", body: { reason: "spam" } });
    const oneMore = (await api(`/entries/by/${W.handle}/${p.slug}?m`)).status;
    r.check("AD-02", "listed with its reasons; hidden at 3; Keep up shows it and clears the list; one new report doesn't hide it again", listed && hiddenBefore === 404 && kept && after === 200 && !stillListed && oneMore === 200, {
      listed,
      hiddenBefore,
      after,
      stillListed,
      oneMore,
    });
  });

  await r.step("AD-03", "hiding a page and showing it again", async () => {
    await reload();
    const hid = await submitForm({ id: p.id, status: "hidden" });
    await sleep(1500);
    const pub = (await api(`/entries/by/${W.handle}/${p.slug}?h`)).status;
    const writer = (await internal(`/users/${W.id}/entries`)).json.find((e) => e.id === p.id)?.status;
    await reload();
    const inHidden = (await sectionText("hidden")).includes(`Reported ${ts}`);
    await submitForm({ id: p.id, status: "visible" }, "hidden");
    await sleep(1500);
    const back = (await api(`/entries/by/${W.handle}/${p.slug}?b`)).status;
    r.check("AD-03", "hidden from everyone but its writer, listed under hidden pages, and back on restore", hid !== false && pub === 404 && writer === "hidden" && inHidden && back === 200, { pub, writer, inHidden, back });
  });

  await r.step("AD-04", "suspending a member, and restoring them", async () => {
    const S = await makeMember("susp");
    const sp = await writePage(S, { title: `Suspended page ${ts}` });
    const B = await browser();
    await signInUi(B.page, S);
    const ids = await discoverActions(B.page);
    await page.goto(`${SITE}/admin?q=${encodeURIComponent(S.email)}#members`, 1200);
    await submitForm({ id: S.id, status: "suspended" }, "members");
    await sleep(2000);
    const call = (n, ...a) => action(B.page, ids, n, ...a);
    const write = await call("saveEntry", null, { title: "while suspended", body: "x", visibility: "public" });
    const note = await call("noteAsMember", p.id, "while suspended");
    const chat = await call("startChat", [W.handle]);
    const ticket = await call("uploadTicket");
    const desk = await fetch(`${SITE}/u/${S.handle}`);
    const profile = await api(`/profiles/${S.handle}`);
    const pagePub = await api(`/entries/by/${S.handle}/${sp.slug}`);
    const del = await call("deleteEntry", sp.id);
    const meNow = await B.page.fetchJson("/me");
    r.check("AD-04", "suspended: can't write, note, message or upload; desktop and pages closed; can still sign in and delete own pages", write.value?.ok === false && note.value?.ok === false && chat.value?.ok === false && ticket.value?.ok === false && profile.status === 404 && pagePub.status === 404 && del.value?.ok === true && JSON.parse(meNow.body)?.suspended === true, {
      write: write.value?.error,
      note: note.value?.error,
      chat: chat.value?.error,
      upload: ticket.value?.error,
      desktop: desk.status,
      profile: profile.status,
      page: pagePub.status,
      deleteOwn: del.value,
    });
    const shout = await api(`/guestbook`, { method: "POST", body: { name: "Guest", body: "hi", owner: S.handle } });
    const subscribe = await makeMember("subx");
    const sub = await internal(`/users/${subscribe.id}/subscriptions/${S.handle}`, { method: "POST" });
    r.info("AD-04b", "a suspended member's guestbook and subscribe button", { shout: shout.status, subscribe: sub.status });
    await page.goto(`${SITE}/admin?q=${encodeURIComponent(S.email)}#members`, 1200);
    await submitForm({ id: S.id, status: "active" }, "members");
    await sleep(1500);
    const again = await call("saveEntry", null, { title: `Back ${ts}`, body: "x", visibility: "public" });
    r.check("AD-04c", "restored: can write again", again.value?.ok === true, again.value?.error);
    await B.close();
  });

  await r.step("AD-05", "held notes and shouts: approve and hide", async () => {
    const n = (await api(`/entries/${p.id}/notes`, { method: "POST", body: { name: "Linker", body: `see https://a.example/${ts}` } })).json.note;
    const s = (await api(`/guestbook`, { method: "POST", body: { name: "Linker", body: `see https://b.example/${ts}`, owner: W.handle } })).json.shout;
    await reload();
    const inbox = await sectionText("inbox");
    await submitForm({ kind: "note", id: n.id, status: "visible" }, "inbox");
    await sleep(1500);
    await reload();
    await submitForm({ kind: "shout", id: s.id, status: "hidden" }, "inbox");
    await sleep(1500);
    const notes = (await api(`/entries/${p.id}/notes?x`)).json ?? [];
    const shouts = (await api(`/guestbook?owner=${W.handle}&x`)).json ?? [];
    r.check("AD-05", "both listed; approved note shows; hidden shout stays out", inbox.includes(`a.example/${ts}`) && inbox.includes(`b.example/${ts}`) && notes.some((x) => x.id === n.id) && !shouts.some((x) => x.id === s.id), {
      listed: [inbox.includes(`a.example/${ts}`), inbox.includes(`b.example/${ts}`)],
    });
  });

  await r.step("AD-06", "reported notes: listed, and restoring one", async () => {
    const n = (await api(`/entries/${p.id}/notes`, { method: "POST", body: { name: "Rude", body: `rude ${ts}` } })).json.note;
    for (let i = 0; i < 3; i++) await api(`/entries/notes/${n.id}/report`, { method: "POST", body: { reason: "hurtful" } });
    await reload();
    const listed = (await sectionText("note-reports")).includes(`rude ${ts}`);
    const restored = await submitForm({ kind: "note", id: n.id, status: "visible" }, "note-reports");
    await sleep(1500);
    await reload();
    const stillListed = (await sectionText("note-reports")).includes(`rude ${ts}`);
    const shown = ((await api(`/entries/${p.id}/notes?r`)).json ?? []).some((x) => x.id === n.id);
    r.check("AD-06", "a note hidden by 3 reports is listed; restoring shows it and clears its reports", listed && restored && shown && !stillListed, { listed, restored, shown, stillListed });
  });

  await r.step("AD-07", "the error list: a browser error arrives, flooding is capped, Clear empties it", async () => {
    const G = await browser();
    await G.page.goto(`${SITE}/`, 1500);
    const gids = await discoverActions(G.page);
    for (let i = 0; i < 30; i++) await action(G.page, gids, "reportBrowserError", `QA boom ${ts}`, "/u/x?secret=1");
    await action(G.page, gids, "reportBrowserError", `QA other ${ts}`, "/");
    await reload();
    const errs = await sectionText("errors");
    const rows = (await api(`/admin/errors`, { headers: { authorization: `Bearer ${process.env.LOCAL_ADMIN_TOKEN}` } })).json ?? [];
    const mine = rows.filter((x) => x.message.includes(ts));
    r.check("AD-07", "browser errors are kept, one row per kind with a count, query strings dropped", errs.includes(`QA boom ${ts}`) && mine.length === 2 && !JSON.stringify(mine).includes("secret=1"), mine.map((x) => ({ message: x.message, count: x.count, path: x.path })));
    const cleared = await page.eval(`(() => { const f = document.querySelector("#errors form"); if (!f) return false; f.requestSubmit(); return true; })()`);
    await sleep(1500);
    await reload();
    r.check("AD-07b", "Clear empties the list", cleared && !(await sectionText("errors")).includes(`QA boom ${ts}`));
    await G.close();
  });

  await r.step("AD-08", "planning a night through the form, and cancelling it", async () => {
    await reload();
    const tomorrow = await page.eval(`(() => { const i = document.querySelector("#nights input[name=night]"); const d = new Date(i.min + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 3); return d.toISOString().slice(0,10); })()`);
    await page.fill("#nights input[name=night]", tomorrow);
    await page.fill("#nights input[name=title]", `Plan ${ts}`);
    await page.fill("#nights input[name=question]", "What did you keep?");
    await page.eval(`document.querySelector("#nights form.admin-plan").requestSubmit()`);
    await sleep(2000);
    await reload();
    const listed = (await sectionText("nights")).includes(`Plan ${ts}`);
    const plan = (await api(`/nights/${tomorrow}/plan`)).json;
    await page.eval(`(() => { const li = [...document.querySelectorAll("#nights li")].find(l => l.innerText.includes(${JSON.stringify(`Plan ${ts}`)})); li?.querySelector("form")?.requestSubmit(); })()`);
    await sleep(2000);
    const gone = (await api(`/nights/${tomorrow}/plan?g`)).json;
    r.check("AD-08", "planned night listed and public; cancel removes it", listed && plan.event?.title === `Plan ${ts}` && !gone.event, { listed, planned: plan.event?.title, after: gone.event });
  });

  await r.step("AD-09", "a line in tonight's poem can't be taken down from /admin", async () => {
    const line = (await api(`/nights/lines`, { method: "POST", body: { name: "Vandal", body: `ugly words ${ts}` } })).json?.line;
    await reload();
    const html = await page.eval(`document.body.innerText`);
    const anyPoemSection = /poem|lines/i.test(await page.eval(`[...document.querySelectorAll("section h2, section b")].map(e => e.innerText).join(" ")`));
    r.check("AD-09", "the moderator can see and remove poem lines in /admin", anyPoemSection && html.includes(`ugly words ${ts}`), { lineId: line?.id, poemSectionInAdmin: anyPoemSection });
  });

  await r.step("AD-10", "/admin's form actions refuse a visitor without the moderator's cookie", async () => {
    const ids = await discoverActions(page);
    const X = await browser();
    await X.page.goto(`${SITE}/`, 1000);
    const res = await X.page.eval(`(async () => {
      const fd = new FormData();
      fd.append("$ACTION_ID_" + ${JSON.stringify(ids.moderateEntry ?? "")}, "");
      fd.append("id", "${p.id}"); fd.append("status", "hidden");
      const r = await fetch("/admin", { method: "POST", body: fd, redirect: "manual" });
      return { status: r.status, type: r.type };
    })()`);
    await sleep(1000);
    const still = (await api(`/entries/by/${W.handle}/${p.slug}?z`)).status;
    r.check("AD-10", "a forged moderateEntry call by a stranger changes nothing", Boolean(ids.moderateEntry) && still === 200, { found: Boolean(ids.moderateEntry), res, pageStatus: still });
    await X.close();
  });

  await r.step("AD-11", "the morning-email cron only answers its secret", async () => {
    const none = await fetch(`${SITE}/api/cron/digest`);
    const wrong = await fetch(`${SITE}/api/cron/digest`, { headers: { authorization: "Bearer nope" } });
    const right = await fetch(`${SITE}/api/cron/digest`, { headers: { authorization: `Bearer ${process.env.LOCAL_CRON_SECRET}` } });
    r.check("AD-11", "no secret or a wrong one: 404; the right one runs (mail is off here, so it skips)", none.status === 404 && wrong.status === 404 && right.status === 200, {
      none: none.status,
      wrong: wrong.status,
      right: `${right.status} ${await right.text()}`,
    });
  });

  await r.step("AD-12", "log off", async () => {
    await reload();
    await page.eval(`[...document.querySelectorAll("form")].find(f => /log off|log out/i.test(f.innerText))?.requestSubmit()`);
    await sleep(1500);
    await page.goto(`${SITE}/admin`, 1000);
    r.check("AD-12", "after log off, /admin asks for the password again", await page.eval(`Boolean(document.querySelector("input[name=password]"))`));
  });
} finally {
  r.info("AD-99", "browser problems", page.problems.slice(0, 10));
  r.save();
  await A.close();
}
