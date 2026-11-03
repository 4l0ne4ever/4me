// No account needed: the moderator's log-on refusing repeated wrong passwords (F2), the phone layout, and page times.
// The admin check sends obviously wrong passwords only; it never guesses.
import { browser } from "./cdp.mjs";
import { guest, OUT, recorder, SITE, sleep } from "./lib.mjs";

const r = recorder("site-run");

await r.step("S-01", "/admin after repeated wrong passwords", async () => {
  const { page, close } = await browser();
  const answers = [];
  for (let i = 1; i <= 10; i++) {
    await page.goto(`${SITE}/admin`, 1200);
    await page.waitFor(`document.querySelector("input[name=password]")`);
    await page.fill("input[name=password]", `definitely-wrong-${i}-${Date.now()}`);
    const t = Date.now();
    await page.eval(`document.querySelector("input[name=password]").closest("form").requestSubmit()`);
    await page
      .waitFor(`location.search.includes("error") || document.body.innerText.toLowerCase().includes("too many")`, 15000)
      .catch(() => null);
    answers.push({ i, ms: Date.now() - t, url: await page.eval("location.pathname + location.search") });
  }
  const limited = answers.some((a) => !a.url.includes("error=password"));
  r.check(
    "S-01",
    "10 wrong passwords in a row meet a limit or a lockout",
    limited,
    answers.map((a) => `${a.i}:${a.ms}ms ${a.url}`),
  );
  await page.screenshot(`${OUT}/s01-admin-after-10.png`);
  await close();
});

await r.step("S-02", "phone layout as a guest", async () => {
  const { page, close } = await browser({ width: 390, height: 844, mobile: true });
  await page.goto(`${SITE}/`, 3000);
  const overflow = await page.eval(`document.documentElement.scrollWidth > window.innerWidth + 1`);
  await page.screenshot(`${OUT}/s02-phone-front.png`);
  // A tester's own diary, so no real member's words end up in the evidence.
  await page.goto(`${SITE}/u/${process.env.PHONE_HANDLE ?? "hdiu"}`, 3000);
  await page.screenshot(`${OUT}/s02-phone-diary.png`);
  const overflowPage = await page.eval(`document.documentElement.scrollWidth > window.innerWidth + 1`);
  r.check("S-02", "no sideways scrolling on a phone", !overflow && !overflowPage, {
    front: overflow,
    page: overflowPage,
  });
  r.info("S-02b", "phone browser problems", page.problems.slice(0, 10));
  await close();
});

await r.step("S-03", "how long pages take for a guest (a handful of loads, not a load test)", async () => {
  const urls = [
    `${SITE}/`,
    `${SITE}/u/hdiu`,
    `${SITE}/welcome`,
    "https://api.2die429.com/entries?limit=20",
    "https://api.2die429.com/archive",
  ];
  const out = {};
  for (const u of urls) {
    const t = [];
    for (let i = 0; i < 3; i++) {
      t.push((await guest(u)).ms);
      await sleep(300);
    }
    out[u.replace("https://", "")] = t;
  }
  r.info("S-03", "ms per load, three loads each", out);
});

r.save();
