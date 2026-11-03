// Shared steps for the 4me end-to-end checks: signing in, the Notepad, and a small result log.
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export const SITE = process.env.SITE ?? "https://2die429.com";
export const API = process.env.API ?? "https://api.2die429.com";
export const OUT = process.env.OUT ?? new URL("../evidence/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

export { sleep };

/** Each check is recorded as PASS / FAIL / INFO with what was seen; one failing check doesn't stop the rest. */
export function recorder(name) {
  const results = [];
  const log = (status, id, title, seen) => {
    results.push({ status, id, title, seen });
    console.log(
      `${status.padEnd(5)} ${id} ${title}${seen === undefined ? "" : ` :: ${typeof seen === "string" ? seen : JSON.stringify(seen)}`}`,
    );
  };
  return {
    results,
    pass: (id, title, seen) => log("PASS", id, title, seen),
    fail: (id, title, seen) => log("FAIL", id, title, seen),
    info: (id, title, seen) => log("INFO", id, title, seen),
    check: (id, title, ok, seen) => log(ok ? "PASS" : "FAIL", id, title, seen),
    async step(id, title, fn) {
      try {
        await fn();
      } catch (e) {
        log("ERROR", id, title, String(e?.message ?? e).slice(0, 300));
      }
    },
    save() {
      writeFileSync(
        `${OUT}/${name}.json`,
        JSON.stringify({ at: new Date().toISOString(), site: SITE, results }, null, 2),
      );
    },
  };
}

export async function signIn(page, email, password) {
  await page.goto(`${SITE}/welcome`, 2500);
  await page.clickTextUntil("I have an account", `document.querySelector("#si-email")`, ".wl-tile");
  await page.fill("#si-email", email);
  await page.fill("#si-password", password);
  const t = Date.now();
  await page.click(".wl-form button[type=submit]");
  await page.waitFor(`location.pathname !== "/welcome" || document.querySelector(".wl-error")?.innerText`, 20000);
  const error = await page.eval(`document.querySelector(".wl-error")?.innerText ?? null`);
  if (error) throw new Error(`sign-in refused: ${error}`);
  await sleep(2500);
  return Date.now() - t;
}

export async function me(page) {
  const r = await page.fetchJson("/me");
  return JSON.parse(r.body || "null");
}

/** Opens the Notepad on its "New page" tab. */
export async function notepad(page) {
  if (!(await page.eval(`Boolean(document.querySelector("#wr-title"))`)))
    await page.clickTextUntil("Write tonight's page", `document.querySelector("#wr-title")`, "button, a");
  await page.waitFor(`document.querySelector("#wr-title")`);
}

export async function notepadTab(page, label) {
  await page.clickText(label, ".wr-tab");
  await sleep(1200);
}

/** Fills the New page form. `seal` is a Date for a letter to the future. */
export async function fillPage(page, p) {
  await page.fill("#wr-title", p.title);
  await page.fill("#wr-body", p.body);
  if (p.mood !== undefined) await page.fill("#wr-mood", p.mood);
  if (p.weather !== undefined) await page.fill("#wr-weather", p.weather);
  if (p.visibility) await page.fill("#wr-vis", p.visibility);
  if (p.slug !== undefined) await page.fill("#wr-slug", p.slug);
  if (p.seal) {
    const on = await page.eval(`document.querySelector(".wr-seal input[type=checkbox]").checked`);
    if (!on) await page.click(".wr-seal input[type=checkbox]");
    await page.waitFor(`document.querySelector("#wr-opens")`);
    const d = p.seal;
    const pad = (n) => String(n).padStart(2, "0");
    await page.fill(
      "#wr-opens",
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  }
}

/** Presses Save and returns the line the Notepad answers with: { ok, text }. */
export async function savePage(page, { double = false } = {}) {
  // Old answers are only marked, never removed: React owns those nodes, and removing them breaks the page.
  await page.eval(`document.querySelectorAll(".wr-form .acc-ok, .wr-form .err").forEach(e => e.dataset.qaOld = "1")`);
  const t = Date.now();
  if (double)
    await page.eval(
      `(() => { const b = document.querySelector(".wr-actions button[type=submit]"); b.click(); b.click(); })()`,
    );
  else await page.click(".wr-actions button[type=submit]");
  // A public page, once posted, opens itself: the Notepad's answer may be replaced by the page's own address.
  const from = await page.eval("location.pathname");
  const fresh = `[...document.querySelectorAll(".wr-form .acc-ok, .wr-form .err")].find(e => !e.dataset.qaOld)`;
  const text = await page.waitFor(
    `${fresh}?.innerText || (location.pathname !== ${JSON.stringify(from)} && location.pathname.startsWith("/u/") ? "opened " + location.pathname : "")`,
    25000,
    "the Notepad's answer",
  );
  const ok = text.startsWith("opened ") || (await page.eval(`${fresh}?.classList.contains("acc-ok") ?? false`));
  return { ok, text, ms: Date.now() - t };
}

/** The member's pages as the "My pages" tab lists them. */
export async function myPages(page) {
  await notepadTab(page, "My pages");
  await page.waitFor(`!document.querySelector("#wr-panel-mine .acc-dim")?.innerText.includes("Loading")`);
  return page.eval(
    `[...document.querySelectorAll("#wr-panel-mine li")].map(li => ({ title: li.querySelector("b")?.innerText, meta: li.querySelector("small")?.innerText }))`,
  );
}

/** Opens one of the member's pages in the Notepad for editing. */
export async function editFromMine(page, title) {
  await notepad(page);
  await notepadTab(page, "My pages");
  await page.waitFor(
    `[...document.querySelectorAll("#wr-panel-mine li b")].some(b => b.innerText === ${JSON.stringify(title)})`,
  );
  await page.eval(`(() => {
    const li = [...document.querySelectorAll("#wr-panel-mine li")].find(l => l.querySelector("b")?.innerText === ${JSON.stringify(title)});
    [...li.querySelectorAll("button")].find(b => b.innerText.trim() === "Edit").click();
  })()`);
  await page.waitFor(`document.querySelector("#wr-title")?.value === ${JSON.stringify(title)}`, 15000);
}

/** Deletes one of the member's pages from "My pages", answering the confirm box. */
export async function deleteFromMine(page, title) {
  await notepadTab(page, "My pages");
  const found = await page.eval(`(() => {
    const li = [...document.querySelectorAll("#wr-panel-mine li")].find(l => l.querySelector("b")?.innerText === ${JSON.stringify(title)});
    if (!li) return false;
    [...li.querySelectorAll("button")].find(b => b.innerText.trim() === "Delete").click();
    return true;
  })()`);
  if (!found) return false;
  await page.waitFor(`document.querySelector(".msgbox .btn.danger")`);
  await page.click(".msgbox .btn.danger");
  await page.waitFor(
    `![...document.querySelectorAll("#wr-panel-mine li b")].some(b => b.innerText === ${JSON.stringify(title)})`,
    15000,
  );
  return true;
}

/** A plain request as a guest would make it (no cookies), with its time. */
export async function guest(url, init = {}) {
  const t = Date.now();
  const res = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: { "user-agent": "4me-qa", ...(init.headers ?? {}) },
  });
  const body = await res.text();
  return { status: res.status, body, ms: Date.now() - t, headers: res.headers };
}

/**
 * The site's server actions by name, read from the scripts the page loaded (the ids change with every build).
 * Calling one this way is exactly what the page's own buttons do: same endpoint, same session cookie.
 */
export async function discoverActions(page) {
  // Locally (next dev) the ids are in Next's own manifest, with their names; production bundles carry them inline.
  if (process.env.ACTIONS_MANIFEST) {
    const { readFileSync } = await import("node:fs");
    const m = JSON.parse(readFileSync(process.env.ACTIONS_MANIFEST, "utf8"));
    return Object.fromEntries(Object.entries(m.node).map(([id, v]) => [v.exportedName, id]));
  }
  return page.eval(`(async () => {
    const urls = [...new Set(performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("/_next/static/chunks/") && n.endsWith(".js")))];
    const out = {};
    for (const u of urls) {
      const js = await fetch(u).then(r => r.text());
      for (const m of js.matchAll(/createServerReference\\)\\("([0-9a-f]{40,})",[^)]*?"([A-Za-z]+)"\\)/g)) out[m[2]] = m[1];
    }
    return out;
  })()`);
}

export async function action(page, ids, name, ...args) {
  if (!ids[name]) throw new Error(`no server action ${name}`);
  const r = await page.eval(`fetch(location.pathname, {
    method: "POST",
    headers: { "Next-Action": ${JSON.stringify(ids[name])}, "Accept": "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
    body: ${JSON.stringify(JSON.stringify(args))},
  }).then(async (res) => ({ status: res.status, text: await res.text() }))`);
  // The flight answer: line "1:" carries the action's return value.
  const line = r.text.split("\n").find((l) => l.startsWith("1:"));
  let value = null;
  try {
    value = line ? JSON.parse(line.slice(2)) : null;
  } catch {
    value = line;
  }
  return { status: r.status, value, raw: value === null ? r.text.slice(0, 300) : undefined };
}
