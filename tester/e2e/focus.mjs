// Narrowing down three things the member run turned up: what of a sealed letter shows before it opens, deleting
// a blast, and whether a guest who opened a page sees notes arrive live. Cleans up after itself.
import { browser } from "./cdp.mjs";
import {
  API,
  deleteFromMine,
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

const r = recorder("focus-run");
const ts = Date.now().toString(36);
const S = { body: `BODYSECRET${ts}`, mood: `MOODSECRET${ts}`, weather: `WEATHERSECRET${ts}` };
const L = { title: `[QA] letter ${ts}`, slug: `qa-${ts}-l` };
const P = { title: `[QA] live ${ts}`, slug: `qa-${ts}-p` };

const M = await browser();
const G = await browser();
let handle;
try {
  await signIn(M.page, process.env.TESTER_EMAIL, process.env.TESTER_PASSWORD);
  handle = (await me(M.page)).handle;

  await r.step("F-11", "sealed letter: which fields show before it opens", async () => {
    await notepad(M.page);
    await fillPage(M.page, {
      title: L.title,
      body: `${S.body} words`,
      mood: S.mood,
      weather: S.weather,
      visibility: "public",
      slug: L.slug,
      seal: new Date(Date.now() + 2 * 86400_000),
    });
    const sealChecked = await M.page.eval(`document.querySelector(".wr-seal input[type=checkbox]").checked`);
    const opens = await M.page.eval(`document.querySelector("#wr-opens")?.value`);
    const res = await savePage(M.page);
    r.info("F-11a", "saved", { res: res.text, sealChecked, opens });
    await sleep(1500);
    const api = JSON.parse((await guest(`${API}/entries/by/${handle}/${L.slug}`)).body);
    r.info("F-11b", "what the public API returns for it", {
      sealedUntil: api.sealedUntil,
      bodyShown: api.body?.includes(S.body),
      mood: api.mood,
      weather: api.weather,
    });
    const places = {
      "GET /entries/by": await guest(`${API}/entries/by/${handle}/${L.slug}`),
      "GET /entries?author": await guest(`${API}/entries?author=${handle}`),
      "GET /entries (front list)": await guest(`${API}/entries?limit=50`),
      "GET /entries/latest": await guest(`${API}/entries/latest?author=${handle}`),
      "page HTML": await guest(`${SITE}/u/${handle}/${L.slug}`),
      "diary HTML": await guest(`${SITE}/u/${handle}`),
      "GET /archive": await guest(`${API}/archive?author=${handle}`),
    };
    const table = Object.fromEntries(
      Object.entries(places).map(([k, v]) => [
        k,
        { body: v.body.includes(S.body), mood: v.body.includes(S.mood), weather: v.body.includes(S.weather) },
      ]),
    );
    const bodyLeak = Object.values(table).some((x) => x.body);
    r.check("F-11c", "the letter's words stay hidden everywhere", !bodyLeak, table);
    r.check(
      "F-11d",
      "the mood and weather stay hidden too (as /archive already does)",
      !Object.values(table).some((x) => x.mood || x.weather),
      table,
    );
    await G.page.goto(`${SITE}/u/${handle}/${L.slug}`, 3000);
    await G.page.screenshot(`${OUT}/f11-sealed-letter-as-guest.png`);
  });

  await r.step("F-15", "deleting a blast", async () => {
    await M.page.goto(`${SITE}/`, 2500);
    await notepad(M.page);
    await M.page.clickText("Blast", ".wr-tab");
    await M.page.waitFor(`document.querySelector("#wr-blast")`);
    await sleep(1500);
    await M.page.fill("#wr-blast", `[QA] blast ${ts}`);
    await M.page.eval(`document.querySelector("#wr-blast").closest("form").requestSubmit()`);
    await M.page.waitFor(
      `[...document.querySelectorAll("#wr-panel-bits li")].some(l => l.innerText.includes("[QA] blast ${ts}"))`,
      15000,
    );
    const before = M.page.responses.length;
    await M.page.eval(`(() => {
      const li = [...document.querySelectorAll("#wr-panel-bits li")].find(l => l.innerText.includes("[QA] blast ${ts}"));
      [...li.querySelectorAll("button")].find(b => b.innerText.trim() === "Delete").click();
    })()`);
    await sleep(4000);
    const stillListed = await M.page.eval(
      `[...document.querySelectorAll("#wr-panel-bits li")].some(l => l.innerText.includes("[QA] blast ${ts}"))`,
    );
    const actions = M.page.responses.slice(before).map((x) => `${x.method} ${x.status} ${x.url.replace(SITE, "")}`);
    const pub = await guest(`${API}/blasts?author=${handle}&limit=30&z=${ts}`);
    r.check(
      "F-15",
      "Delete removes the blast from the Notepad and the diary",
      !stillListed && !pub.body.includes(`[QA] blast ${ts}`),
      {
        stillListed,
        stillPublic: pub.body.includes(`[QA] blast ${ts}`),
        requests: actions,
        panelMsg: (await M.page.text("#wr-panel-bits")).slice(0, 200),
      },
    );
    // Reload and look again: was it deleted at all?
    await M.page.goto(`${SITE}/`, 2500);
    await notepad(M.page);
    await M.page.clickText("Blast", ".wr-tab");
    await sleep(2500);
    const afterReload = await M.page.eval(
      `[...document.querySelectorAll("#wr-panel-bits li")].some(l => l.innerText.includes("[QA] blast ${ts}"))`,
    );
    r.info("F-15b", "after a reload, is it still in the list?", afterReload);
    if (afterReload) {
      // Second try, to see whether it is the first click that is lost.
      await M.page.eval(`(() => {
        const li = [...document.querySelectorAll("#wr-panel-bits li")].find(l => l.innerText.includes("[QA] blast ${ts}"));
        [...li.querySelectorAll("button")].find(b => b.innerText.trim() === "Delete").click();
      })()`);
      await sleep(4000);
      r.info(
        "F-15c",
        "second Delete, still listed?",
        await M.page.eval(
          `[...document.querySelectorAll("#wr-panel-bits li")].some(l => l.innerText.includes("[QA] blast ${ts}"))`,
        ),
      );
    }
  });

  await r.step("F-09", "a guest who opens a fresh public page sees notes arrive live", async () => {
    await M.page.goto(`${SITE}/`, 2500);
    await notepad(M.page);
    await fillPage(M.page, { title: P.title, body: "live test", visibility: "public", slug: P.slug });
    await savePage(M.page);
    await sleep(2000);
    const ms = await G.page.goto(`${SITE}/u/${handle}/${P.slug}`, 4000);
    const shown = await G.page.eval(`document.body.innerText.includes("live test")`);
    const sockets = await G.page.eval(
      `performance.getEntriesByType("resource").filter(e => e.name.includes("/live")).map(e => e.name.slice(0, 160))`,
    );
    r.info("F-09a", "guest opened the page", { ms, shown, sockets });
    for (let round = 1; round <= 3; round++) {
      await M.page.goto(`${SITE}/u/${handle}/${P.slug}`, 3000);
      await M.page.waitFor(`document.querySelector(".cms textarea")`, 15000);
      await M.page.fill(".cms textarea", `[QA] live note ${ts} #${round}`);
      await M.page.click(".cms form button[type=submit]");
      await M.page.waitFor(`document.body.innerText.includes("[QA] live note ${ts} #${round}")`, 15000);
      let live = false;
      const t = Date.now();
      while (!live && Date.now() - t < 15000) {
        live = await G.page.eval(`document.body.innerText.includes("[QA] live note ${ts} #${round}")`);
        if (!live) await sleep(500);
      }
      r.check(`F-09-${round}`, `note #${round} reaches the open guest page live`, live, { ms: Date.now() - t });
    }
    await G.page.screenshot(`${OUT}/f09-guest-after-notes.png`);
  });
} finally {
  await r.step("F-90", "clean up", async () => {
    await M.page.goto(`${SITE}/`, 2500);
    await notepad(M.page);
    const titles = (await myPages(M.page)).map((p) => p.title).filter((t) => t?.startsWith("[QA]"));
    for (const t of titles) await deleteFromMine(M.page, t);
    r.check(
      "F-90",
      "[QA] pages deleted",
      (await myPages(M.page)).every((p) => !p.title?.startsWith("[QA]")),
      titles,
    );
  });
  r.info("F-99", "member browser problems", M.page.problems.slice(0, 15));
  r.info("F-99b", "guest browser problems", G.page.problems.slice(0, 15));
  r.save();
  await M.close();
  await G.close();
}
