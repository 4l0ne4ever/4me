// Signs in one tester and looks around: screenshots and what the desktop shows. Read-only apart from signing in.
// TESTER_EMAIL / TESTER_PASSWORD come from the environment; nothing is written down.
import { mkdirSync } from "node:fs";
import { browser } from "./cdp.mjs";

const SITE = process.env.SITE ?? "https://2die429.com";
const OUT = process.env.OUT ?? new URL("../evidence/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const { page, close } = await browser();
try {
  const t1 = await page.goto(`${SITE}/welcome`);
  console.log("welcome load ms", t1);
  await page.screenshot(`${OUT}/01-welcome.png`);
  console.log(await page.text(".wl-users"));
  await page.clickTextUntil("I have an account", `document.querySelector("#si-email")`, ".wl-tile");
  await page.fill("#si-email", process.env.TESTER_EMAIL);
  await page.fill("input[name=password]", process.env.TESTER_PASSWORD);
  const started = Date.now();
  await page.click(".wl-form button[type=submit]");
  await page.waitFor(`location.pathname !== "/welcome" || document.querySelector(".wl-error")?.innerText`, 20000);
  console.log("sign-in ms", Date.now() - started, "now at", await page.eval("location.href"));
  console.log("error?", await page.eval(`document.querySelector(".wl-error")?.innerText ?? null`));
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot(`${OUT}/02-desktop.png`);
  const me = await page.fetchJson("/me");
  const parsed = JSON.parse(me.body || "null");
  console.log(
    "me:",
    parsed && {
      id: parsed.id,
      handle: parsed.handle,
      name: parsed.displayName,
      verified: parsed.emailVerified,
      suspended: parsed.suspended,
      google: parsed.google,
    },
  );
  console.log(
    "windows:",
    await page.eval(
      `[...document.querySelectorAll("[role=dialog], .win")].map(w => (w.getAttribute("aria-label") || w.querySelector(".title, .win-title")?.innerText || "").slice(0,60))`,
    ),
  );
  console.log(
    "buttons:",
    await page.eval(
      `[...document.querySelectorAll("button, a")].filter(e=>e.offsetParent).map(e => (e.innerText||e.getAttribute("aria-label")||e.title||"").trim().replace(/\\s+/g," ").slice(0,40)).filter(Boolean).slice(0,80)`,
    ),
  );
  console.log("problems:", page.problems);
} finally {
  await close();
}
