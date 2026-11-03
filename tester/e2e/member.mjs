// One member's flows on the live site, with a guest watching: writing, privacy, sealed letters, notes, reactions,
// markup safety, double submits, unsaved work, and clean-up (photos included).
// Every page it makes is titled "[QA] …" and deleted at the end.
//   TESTER_EMAIL=… TESTER_PASSWORD=… node tester/e2e/member.mjs
import { browser } from "./cdp.mjs";
import {
  API,
  deleteFromMine,
  editFromMine,
  fillPage,
  guest,
  me,
  myPages,
  notepad,
  OUT,
  recorder,
  SITE,
  savePage,
  signIn,
  sleep,
} from "./lib.mjs";

const EMAIL = process.env.TESTER_EMAIL;
const PASSWORD = process.env.TESTER_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("set TESTER_EMAIL and TESTER_PASSWORD");
const PHOTO = new URL("../fixtures/photo.jpg", import.meta.url).pathname;

const r = recorder("member-run");
const ts = Date.now().toString(36);
const A = { title: `[QA] page ${ts}`, slug: `qa-${ts}-a` };
const SECRET = `QASECRET${ts}`;
const L = { title: `[QA] letter ${ts}`, slug: `qa-${ts}-letter` };
const BODY = [
  `QA run ${ts}. _italic words_ and ~~crossed out words~~.`,
  "",
  "> a note in the margin",
  "",
  "| a quoted line",
  "— QA",
  "",
  `[evil](javascript:window.__qa_xss=1) <script>window.__qa_xss=2</script> <img src=x onerror="window.__qa_xss=3">`,
  "",
  "https://example.com/qa",
].join("\n");

const B = await browser();
const G = await browser(); // a guest, never signed in
const made = [];
let photoUrl = null;
let handle = null;

try {
  await r.step("M-01", "sign in", async () => {
    const ms = await signIn(B.page, EMAIL, PASSWORD);
    const m = await me(B.page);
    handle = m?.handle;
    r.check("M-01", "sign in lands on the desktop as the member", Boolean(handle), {
      ms,
      handle,
      verified: m?.emailVerified,
    });
  });
  if (!handle) throw new Error("not signed in");

  await r.step("M-02", "whitespace-only title is refused with a message", async () => {
    await notepad(B.page);
    await fillPage(B.page, { title: "   ", body: "x", visibility: "private" });
    const res = await savePage(B.page);
    r.check("M-02", "whitespace-only title is refused with a message", !res.ok, res.text);
  });

  await r.step("M-03", "private page with a photo", async () => {
    await fillPage(B.page, {
      title: A.title,
      body: BODY,
      mood: "tired",
      weather: "rain",
      visibility: "private",
      slug: A.slug,
    });
    const t = Date.now();
    await B.page.upload("#ph-files", [PHOTO]);
    photoUrl = await B.page.waitFor(
      `[...document.querySelectorAll(".wr-form img")].map(i => i.src).find(s => s.includes("/media/u/"))`,
      30000,
      "uploaded photo",
    );
    r.info("M-03a", "photo uploaded (browser shrink + API)", { ms: Date.now() - t, photoUrl });
    const res = await savePage(B.page);
    r.check("M-03", "private page saves", res.ok, res);
    if (res.ok) made.push(A.title);
  });

  await r.step("M-04", "a private page is not readable by a guest", async () => {
    const api = await guest(`${API}/entries/by/${handle}/${A.slug}`);
    const html = await guest(`${SITE}/u/${handle}/${A.slug}`);
    r.check(
      "M-04",
      "a private page is not readable by a guest",
      api.status === 404 && !html.body.includes(`QA run ${ts}`),
      {
        api: api.status,
        page: html.status,
      },
    );
  });

  await r.step("M-05", "the photo of a private page, by its address", async () => {
    if (!photoUrl) return r.info("M-05", "no photo to check");
    const res = await guest(photoUrl);
    r.info("M-05", "photo of a private page fetched by a guest who has its address", {
      status: res.status,
      cache: res.headers.get("cache-control"),
    });
  });

  // The guest keeps the front desktop open, to see whether the page arrives live in Tonight.
  await G.page.goto(`${SITE}/`, 3000);

  await r.step("M-06", "private -> public", async () => {
    await B.page.fill("#wr-vis", "public");
    const res = await savePage(B.page);
    r.check("M-06", "private page made public saves", res.ok, res);
    const api = await guest(`${API}/entries/by/${handle}/${A.slug}`);
    r.check("M-06b", "the guest can now read it", api.status === 200, { api: api.status });
    await sleep(12000);
    const live = await G.page.eval(`document.body.innerText.includes(${JSON.stringify(A.title)})`);
    r.check("M-06c", "it appears live in the guest's open Tonight (no reload)", live, { appeared: live });
  });

  await r.step("M-07", "markup renders and stays safe", async () => {
    const ms = await G.page.goto(`${SITE}/u/${handle}/${A.slug}`, 3000);
    await G.page.screenshot(`${OUT}/m07-page-as-guest.png`);
    const seen = await G.page.eval(`(() => {
      const box = [...document.querySelectorAll("article, .win, main")].find(e => e.innerText.includes("QA run ${ts}")) ?? document.body;
      const links = [...box.querySelectorAll("a")].map(a => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })).filter(a => /example|javascript/.test(a.href ?? ""));
      return {
        xss: window.__qa_xss ?? null,
        italic: Boolean([...box.querySelectorAll("em, i")].find(e => e.innerText.includes("italic words"))),
        crossed: Boolean([...box.querySelectorAll("s, del")].find(e => e.innerText.includes("crossed out"))),
        scriptAsText: box.innerText.includes("<script>"),
        links,
      };
    })()`);
    r.info("M-07a", "page load as guest (ms)", ms);
    r.check("M-07", "no script runs from the page body", seen.xss === null, seen);
    r.check(
      "M-07b",
      "javascript: link is not a live link",
      !seen.links.some((l) => /^javascript:/i.test(l.href ?? "")),
      seen.links,
    );
    r.check("M-07c", "italic and crossed-out markup render", seen.italic && seen.crossed, {
      italic: seen.italic,
      crossed: seen.crossed,
    });
  });

  await r.step("M-08", "public -> private hides it at once", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await editFromMine(B.page, A.title);
    await B.page.fill("#wr-vis", "private");
    const res = await savePage(B.page);
    const api = await guest(`${API}/entries/by/${handle}/${A.slug}`);
    const html = await guest(`${SITE}/u/${handle}/${A.slug}`);
    const leaked = html.body.includes(`QA run ${ts}`);
    r.check("M-08", "right after making it private, a guest can't read it", res.ok && api.status !== 200 && !leaked, {
      api: api.status,
      page: html.status,
      bodyInHtml: leaked,
      vercelCache: html.headers.get("x-vercel-cache"),
    });
    const front = await guest(`${SITE}/`);
    r.check("M-08b", "the front page no longer lists it", !front.body.includes(A.title), {
      listed: front.body.includes(A.title),
      vercelCache: front.headers.get("x-vercel-cache"),
    });
    const rss = await guest(`${SITE}/u/${handle}/rss.xml`);
    r.info("M-08c", "the diary's RSS after it went private", {
      status: rss.status,
      stillThere: rss.body.includes(`QA run ${ts}`),
    });
    // Public again for the notes and reactions below.
    await B.page.fill("#wr-vis", "public");
    r.info("M-08d", "made public again", (await savePage(B.page)).text);
  });

  await r.step("M-09", "the writer leaves a note on their page; a guest sees it live", async () => {
    await G.page.goto(`${SITE}/u/${handle}/${A.slug}`, 3000);
    await B.page.goto(`${SITE}/u/${handle}/${A.slug}`, 3000);
    await B.page.waitFor(`document.querySelector(".cms textarea")`, 15000);
    await B.page.fill(".cms textarea", `[QA] note ${ts}`);
    const t = Date.now();
    await B.page.click(".cms form button[type=submit]");
    await B.page.waitFor(
      `[...document.querySelectorAll(".cm-main")].some(n => n.innerText.includes("[QA] note ${ts}"))`,
      15000,
    );
    const badge = await B.page.eval(
      `[...document.querySelectorAll(".cm-main")].find(n => n.innerText.includes("[QA] note ${ts}"))?.querySelector(".cm-badge")?.innerText ?? null`,
    );
    r.check("M-09", "note posts and carries the writer badge", badge === "writer", { ms: Date.now() - t, badge });
    let live = false;
    for (let i = 0; i < 20 && !live; i++) {
      live = await G.page.eval(`document.body.innerText.includes("[QA] note ${ts}")`);
      if (!live) await sleep(500);
    }
    r.check("M-09b", "the guest reading the page sees the note without reloading", live);
  });

  await r.step("M-10", "a reaction on the page counts once and can be taken back", async () => {
    await B.page.click(".rx-add");
    await B.page.waitFor(`document.querySelector(".rx-pal button")`);
    await B.page.eval(`document.querySelector(".rx-pal button").click()`);
    await sleep(2500);
    const chips = await B.page.eval(
      `[...document.querySelectorAll(".rx-chip")].map(c => c.getAttribute("aria-label"))`,
    );
    let seen = [];
    for (let i = 0; i < 12 && !seen.length; i++) {
      seen = await G.page.eval(`[...document.querySelectorAll(".rx-chip")].map(c => c.getAttribute("aria-label"))`);
      if (!seen.length) await sleep(500);
    }
    r.check(
      "M-10",
      "one reaction shows for the member, and live for the guest",
      chips.length === 1 && seen.length === 1,
      { member: chips, guest: seen },
    );
    await B.page.eval(`document.querySelector(".rx-chip.mine")?.click()`);
    await sleep(2500);
    const back = await B.page.eval(`[...document.querySelectorAll(".rx-chip")].map(c => c.getAttribute("aria-label"))`);
    r.check("M-10b", "picking it again takes it back", back.length === 0, back);
  });

  await r.step("M-11", "sealed letter keeps its words", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    const opens = new Date(Date.now() + 2 * 86400_000);
    await fillPage(B.page, {
      title: L.title,
      body: `The secret is ${SECRET}. It should not be read before it opens.`,
      mood: SECRET,
      visibility: "public",
      slug: L.slug,
      seal: opens,
    });
    const res = await savePage(B.page);
    r.check("M-11", "sealed letter saves", res.ok, res.text);
    if (res.ok) made.push(L.title);
    await sleep(1500);
    const where = {
      api: await guest(`${API}/entries/by/${handle}/${L.slug}`),
      page: await guest(`${SITE}/u/${handle}/${L.slug}`),
      list: await guest(`${API}/entries?author=${handle}`),
      latest: await guest(`${API}/entries/latest?author=${handle}`),
      archive: await guest(`${API}/archive?author=${handle}`),
      lines: await guest(`${API}/entries/lines`),
      search: await guest(`${API}/search?q=${SECRET}`),
      rss: await guest(`${SITE}/u/${handle}/rss.xml`),
      diary: await guest(`${SITE}/u/${handle}`),
    };
    const leaks = Object.entries(where)
      .filter(([, v]) => v.body.includes(SECRET))
      .map(([k]) => k);
    r.check("M-11b", "the secret words and mood show nowhere a guest can look", leaks.length === 0, {
      leaks,
      statuses: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, v.status])),
    });
    await G.page.goto(`${SITE}/u/${handle}/${L.slug}`, 3000);
    await G.page.screenshot(`${OUT}/m11-sealed-as-guest.png`);
  });

  await r.step("M-12", "pressing Save twice quickly makes one page", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    const title = `[QA] double ${ts}`;
    await fillPage(B.page, { title, body: "double", visibility: "private" });
    const res = await savePage(B.page, { double: true });
    await sleep(3000);
    const n = (await myPages(B.page)).filter((p) => p.title === title).length;
    if (n) made.push(title);
    r.check("M-12", "pressing Save twice quickly makes one page", n === 1, { saved: res.text, pages: n });
    if (n > 1) for (let i = 1; i < n; i++) made.push(title);
  });

  await r.step("M-13", "an address already used is refused clearly", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    const title = `[QA] same address ${ts}`;
    await fillPage(B.page, { title, body: "x", visibility: "private", slug: A.slug });
    const res = await savePage(B.page);
    if (res.ok) made.push(title);
    r.check("M-13", "an address already used is refused clearly", !res.ok && /address/.test(res.text), res.text);
  });

  await r.step("M-14", "unsaved work survives a reload", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    await fillPage(B.page, { title: `[QA] unsaved ${ts}`, body: "words I did not save" });
    await sleep(2500);
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    await sleep(1500);
    const kept = await B.page.eval(`document.querySelector(".wr-kept")?.innerText ?? null`);
    r.check("M-14", "Notepad offers the unsaved page back after a reload", Boolean(kept), kept);
    if (kept) await B.page.clickText("Throw", ".wr-kept button").catch(() => null);
  });

  await r.step("M-15", "a blast shows on the diary and can be deleted", async () => {
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    await B.page.clickText("Blast", ".wr-tab");
    await B.page.waitFor(`document.querySelector("#wr-blast")`);
    await sleep(1500);
    await B.page.fill("#wr-blast", `[QA] blast ${ts}`);
    await B.page.eval(`document.querySelector("#wr-blast").closest("form").requestSubmit()`);
    const listed = await B.page
      .waitFor(
        `[...document.querySelectorAll("#wr-panel-bits li")].some(l => l.innerText.includes("[QA] blast ${ts}"))`,
        15000,
      )
      .catch(() => false);
    const pub = await guest(`${API}/blasts?author=${handle}&limit=30&x=${ts}`);
    r.check("M-15", "the blast is listed and public on the diary", listed && pub.body.includes(`[QA] blast ${ts}`), {
      listed,
      public: pub.body.includes(`[QA] blast ${ts}`),
      panel: listed ? undefined : (await B.page.text("#wr-panel-bits")).slice(0, 300),
    });
    if (!listed) return;
    await B.page.eval(`(() => {
      const li = [...document.querySelectorAll("#wr-panel-bits li")].find(l => l.innerText.includes("[QA] blast ${ts}"));
      [...li.querySelectorAll("button")].find(b => b.innerText.trim() === "Delete").click();
    })()`);
    await sleep(3000);
    const after = await guest(`${API}/blasts?author=${handle}&limit=30&y=${ts}`);
    r.check("M-15b", "the deleted blast is gone", !after.body.includes(`[QA] blast ${ts}`));
  });
} finally {
  // Clean up: every [QA] page goes, then the photo is checked again (README: deleting a page deletes its photos).
  await r.step("M-90", "clean up", async () => {
    if (photoUrl) {
      await guest(photoUrl);
      await guest(photoUrl);
    }
    await B.page.goto(`${SITE}/`, 2500);
    await notepad(B.page);
    const titles = (await myPages(B.page)).map((p) => p.title).filter((t) => t?.startsWith("[QA]"));
    for (const t of titles) await deleteFromMine(B.page, t);
    const left = (await myPages(B.page)).filter((p) => p.title?.startsWith("[QA]")).length;
    r.check("M-90", "every [QA] page deleted", left === 0, { deleted: titles.length, left });
    const page = await guest(`${API}/entries/by/${handle}/${A.slug}`);
    r.check("M-91", "a deleted page is gone for guests", page.status === 404, page.status);
    if (photoUrl) {
      await sleep(3000);
      const p = await guest(photoUrl);
      r.check("M-92", "the deleted page's photo is no longer served", p.status === 404, {
        status: p.status,
        cfCache: p.headers.get("cf-cache-status"),
        age: p.headers.get("age"),
      });
    }
  });
  r.info("M-99", "problems the member's browser saw", B.page.problems.slice(0, 20));
  r.info("M-99b", "problems the guest's browser saw", G.page.problems.slice(0, 20));
  const slow = [...B.page.responses, ...G.page.responses]
    .filter((x) => x.ms > 1500)
    .map((x) => `${x.ms}ms ${x.method} ${x.url.slice(0, 90)}`);
  r.info("M-99c", "responses slower than 1.5 s", slow.slice(0, 15));
  r.save();
  await B.close();
  await G.close();
}
