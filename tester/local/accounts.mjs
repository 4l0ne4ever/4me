// Accounts end to end on the local stack: sign-up and its rules, sign-in, forgotten passwords, email proof,
// profile, desktop address, password change, export, unsubscribe links, deleting an account.
import { createHmac } from "node:crypto";
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, me, recorder, sleep } from "../e2e/lib.mjs";
import { API, api, internal, makeMember, SITE, signInUi, writePage } from "./lib.mjs";

const r = recorder("local-accounts");
const ts = Date.now().toString(36).slice(-6);

let regIp = 0;
async function registerUi(page, f) {
  // Each sign-up from its own address (the web server passes x-real-ip on), so the 5-an-hour limit doesn't mix in.
  await page.send("Network.setExtraHTTPHeaders", { headers: { "x-real-ip": `203.0.113.${++regIp}` } });
  await page.goto(`${SITE}/welcome${f.next ? `?next=${encodeURIComponent(f.next)}` : ""}`, 1500);
  await page.clickTextUntil("Create a new account", `document.querySelector("#rg-email")`, ".wl-tile");
  await page.fill("#rg-name", f.name);
  await page.fill("#rg-email", f.email);
  await page.fill("#rg-password", f.password);
  await page.fill("#rg-confirm", f.confirm ?? f.password);
  await page.eval(`document.querySelectorAll(".wl-error").forEach(e => e.dataset.qaOld = "1")`);
  const native = await page.eval(`(() => { const f = document.querySelector("#rg-email").closest("form"); if (f.checkValidity()) return null; return [...f.elements].find(e => !e.validity?.valid)?.validationMessage ?? "invalid"; })()`);
  if (native) return `browser: ${native}`;
  await page.eval(`document.querySelector("#rg-email").closest("form").requestSubmit()`);
  return page.waitFor(
    `location.pathname !== "/welcome" ? "moved:" + location.pathname + location.search : [...document.querySelectorAll(".wl-error")].find(e => !e.dataset.qaOld)?.innerText`,
    20000,
  );
}

const W = await browser();
const page = W.page;
try {
  // ---------- sign-up ----------
  const email = `new${ts}@example.test`;
  const name = `New ${ts}`;
  await r.step("A-01", "sign-up rules", async () => {
    const cases = {
      "passwords differ": await registerUi(page, { name, email, password: "longenough1", confirm: "longenough2" }),
      "password 7 chars": await registerUi(page, { name, email, password: "short77" }),
      "name 1 char": await registerUi(page, { name: "x", email, password: "longenough1" }),
      "name with emoji": await registerUi(page, { name: "night 🌙", email, password: "longenough1" }),
      "reserved name 'admin'": await registerUi(page, { name: "Admin", email, password: "longenough1" }),
      "reserved name '4 me'": await registerUi(page, { name: "4 me", email, password: "longenough1" }),
      "seed member's name 'LAN'": await registerUi(page, { name: "LAN", email, password: "longenough1" }),
      "bad email": await registerUi(page, { name, email: "not-an-email", password: "longenough1" }),
    };
    const accepted = Object.entries(cases).filter(([, v]) => String(v).startsWith("moved:"));
    r.check("A-01", "every bad sign-up is refused with a message", accepted.length === 0, cases);
  });

  await r.step("A-02", "a good sign-up lands on the desktop signed in, with a desktop address made from the name", async () => {
    const res = await registerUi(page, { name, email: email.toUpperCase(), password: "longenough1", next: "/u/lan" });
    const m = await me(page);
    r.check("A-02", "a good sign-up signs in and follows ?next", String(res).startsWith("moved:/u/lan") && m?.displayName === name, {
      res,
      handle: m?.handle,
      email: m?.email,
      verified: m?.emailVerified,
    });
    r.check("A-02b", "the address is stored lower-case", m?.email === email, m?.email);
  });

  await r.step("A-03", "the same address or name again is refused", async () => {
    await page.send("Network.clearBrowserCookies");
    const sameEmail = await registerUi(page, { name: `Other ${ts}`, email, password: "longenough1" });
    const sameName = await registerUi(page, { name: name.toUpperCase(), email: `x${email}`, password: "longenough1" });
    r.check("A-03", "duplicate email and duplicate name (any case) are refused", !String(sameEmail).startsWith("moved") && !String(sameName).startsWith("moved"), {
      sameEmail,
      sameName,
    });
  });

  await r.step("A-04", "open redirect after sign-in is blocked", async () => {
    const out = {};
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const res = await registerUi(page, {
        name: `R${ts}${Object.keys(out).length}`,
        email: `r${Object.keys(out).length}${ts}@example.test`,
        password: "longenough1",
        next,
      });
      out[next] = res;
      await page.send("Network.clearBrowserCookies");
    }
    r.check("A-04", "?next pointing off-site goes home instead", Object.values(out).every((v) => v === "moved:/"), out);
  });

  // ---------- sign-in ----------
  const m = await makeMember("acct");
  await r.step("A-05", "sign-in: wrong password, unknown address, then the right one", async () => {
    await page.send("Network.clearBrowserCookies");
    const attempt = async (e, p) => {
      await page.goto(`${SITE}/welcome`, 1200);
      await page.clickTextUntil("I have an account", `document.querySelector("#si-email")`, ".wl-tile");
      await page.fill("#si-email", e);
      await page.fill("#si-password", p);
      const t = Date.now();
      await page.click(".wl-form button[type=submit]");
      const res = await page.waitFor(`location.pathname !== "/welcome" ? "in" : document.querySelector(".wl-error")?.innerText`, 20000);
      return { res, ms: Date.now() - t };
    };
    const wrong = await attempt(m.email, "wrong-password");
    const unknown = await attempt(`nobody${ts}@example.test`, "wrong-password");
    const right = await attempt(m.email.toUpperCase(), m.password);
    r.check("A-05", "same message for wrong password and unknown address; right one signs in (any case)", wrong.res === unknown.res && right.res === "in", {
      wrong,
      unknown,
      right,
    });
  });

  await r.step("A-06", "sign-in is limited per address (10 per 15 minutes)", async () => {
    const victim = await makeMember("lock");
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await internal("/sign-in", { method: "POST", body: { email: victim.email } })).status);
    // The victim, from another address, with the right password:
    await page.send("Network.clearBrowserCookies");
    let blocked = null;
    try {
      await signInUi(page, victim);
    } catch (e) {
      blocked = String(e.message);
    }
    r.check("A-06", "after 10 tries by someone else, the real owner is locked out too (F11)", blocked !== null, { codes, owner: blocked ?? "signed in" });
  });

  // ---------- forgot / reset / verify ----------
  await r.step("A-07", "forgot password without mail switched on", async () => {
    await page.send("Network.clearBrowserCookies");
    await page.goto(`${SITE}/welcome`, 1200);
    await page.clickTextUntil("I have an account", `document.querySelector("#si-email")`, ".wl-tile");
    const forgotShown = await page.eval(`[...document.querySelectorAll("button")].some(b => /forgot/i.test(b.innerText))`);
    r.info("A-07", "is the 'forgot' link shown when no mail is configured?", forgotShown);
    if (forgotShown) {
      await page.clickText("Forgot", "button");
      await page.waitFor(`document.querySelector("#fp-email")`);
      await page.fill("#fp-email", m.email);
      await page.eval(`document.querySelector("#fp-email").closest("form").requestSubmit()`);
      const said = await page.waitFor(`document.querySelector(".wl-error, .wl-note")?.innerText`, 10000);
      r.info("A-07b", "what it says", said);
    }
  });

  await r.step("A-08", "a reset link works once, signs out old sessions, and proves the address", async () => {
    const who = await makeMember("reset");
    const other = await browser();
    await signInUi(other.page, who);
    const { json } = await internal("/resets", { method: "POST", body: { email: who.email } });
    const reset = async (pw, confirm = pw) => {
      await page.goto(`${SITE}/reset?token=${json.token}`, 1200);
      await page.fill("input[name=password]", pw);
      await page.fill("input[name=confirm]", confirm);
      await page.eval(`document.querySelector("input[name=password]").closest("form").requestSubmit()`);
      return page.waitFor(`location.pathname !== "/reset" ? "moved:" + location.pathname + location.search : document.querySelector(".wl-error")?.innerText`, 15000);
    };
    const mismatch = await reset("brand-new-pass1", "brand-new-pass2");
    const first = await reset("brand-new-pass1");
    const again = await reset("brand-new-pass2");
    const oldSession = await me(other.page);
    await page.send("Network.clearBrowserCookies");
    let signedIn = true;
    try {
      await signInUi(page, { ...who, password: "brand-new-pass1" });
    } catch {
      signedIn = false;
    }
    const after = await me(page);
    r.check("A-08", "reset: mismatch refused, first use works, second refused, old sessions end, address proven", String(first).startsWith("moved:/welcome") && !String(again).startsWith("moved") && oldSession === null && signedIn && after?.emailVerified === true, {
      mismatch,
      first,
      again,
      oldSessionAfter: oldSession,
      verified: after?.emailVerified,
    });
    const bad = await (async () => {
      await page.goto(`${SITE}/reset?token=${"0".repeat(64)}`, 1200);
      await page.fill("input[name=password]", "whatever-pass1");
      await page.fill("input[name=confirm]", "whatever-pass1");
      await page.eval(`document.querySelector("input[name=password]").closest("form").requestSubmit()`);
      return page.waitFor(`document.querySelector(".wl-error")?.innerText`, 10000);
    })();
    r.check("A-08b", "a made-up reset token is refused clearly", Boolean(bad), bad);
    await other.close();
  });

  await r.step("A-09", "proving an address through /verify", async () => {
    const who = await makeMember("verify");
    const { json } = await internal(`/users/${who.id}/email-check`, { method: "POST" });
    await page.goto(`${SITE}/verify?token=${json.token}`, 1500);
    const first = await page.text("main, body");
    await page.goto(`${SITE}/verify?token=${json.token}`, 1500);
    const second = await page.text("main, body");
    await page.goto(`${SITE}/verify?token=abc`, 1500);
    const junk = await page.text("main, body");
    const now = (await internal(`/users/${who.id}`)).json;
    const referrer = await page.eval(`document.querySelector('meta[name="referrer"]')?.content ?? null`);
    r.check("A-09", "verify works once, then says used; junk is explained", now.emailVerified === true && first !== second, {
      first: first.slice(0, 120),
      second: second.slice(0, 120),
      junk: junk.slice(0, 120),
      referrerPolicy: referrer,
    });
  });

  // ---------- the account window's actions ----------
  const B = await browser();
  const who = await makeMember("prof");
  await signInUi(B.page, who);
  const ids = await discoverActions(B.page);
  const call = (n, ...a) => action(B.page, ids, n, ...a);

  await r.step("A-10", "profile: name, picture, bio, Last.fm, and their rules", async () => {
    const lan = await call("updateProfile", { displayName: "Lan" });
    const res = await call("updateProfile", { displayName: `Prof ${ts}`, bio: "x".repeat(160), avatar: "boathouse", lastfmUser: "rj" });
    const tooLong = await call("updateProfile", { bio: "x".repeat(161) });
    const badAvatar = await call("updateProfile", { avatar: "../../etc/passwd" });
    r.check("A-10", "taken name refused; good changes saved; too-long bio and unknown picture refused", lan.value?.ok === false && res.value?.ok !== false && tooLong.value?.ok === false && badAvatar.value?.ok === false, {
      lan: lan.value?.error,
      ok: res.value?.ok ?? res.value,
      tooLong: tooLong.value?.error,
      badAvatar: badAvatar.value?.error,
    });
  });

  await r.step("A-11", "changing the desktop address", async () => {
    const pageBefore = await writePage(who, { title: "Before the move", slug: "before-the-move" });
    const oldHandle = (await me(B.page)).handle;
    const taken = await call("updateProfile", { handle: "lan" });
    const reserved = await call("updateProfile", { handle: "admin" });
    const moved = await call("updateProfile", { handle: `moved_${ts}` });
    await sleep(500);
    const oldUrl = await api(`/entries/by/${oldHandle}/before-the-move`);
    const newUrl = await api(`/entries/by/moved_${ts}/before-the-move`);
    const oldPage = await fetch(`${SITE}/u/${oldHandle}/before-the-move`);
    r.check("A-11", "taken/reserved addresses refused; the move works", taken.value?.ok === false && reserved.value?.ok === false && newUrl.status === 200, {
      taken: taken.value?.error,
      reserved: reserved.value?.error,
      moved: moved.value?.ok ?? moved.value,
    });
    r.info("A-11b", "old links after a move (no redirect is kept)", { api: oldUrl.status, page: oldPage.status, entry: pageBefore.id });
    // Someone else can now take the old address, and old links show their diary.
    const squatter = await makeMember("sq");
    const take = await internal(`/users/${squatter.id}`, { method: "PATCH", body: { handle: oldHandle } });
    r.info("A-11c", "a new member can take the freed address straight away", { status: take.status, handle: take.json?.handle });
  });

  await r.step("A-12", "morning email: only with a proven address", async () => {
    const off = await call("setEmailDigest", true);
    const confirm = await call("confirmEmail");
    r.info("A-12", "turning it on without a proven address / asking for a link with no mail", { digest: off.value, confirm: confirm.value });
  });

  await r.step("A-13", "unsubscribe links", async () => {
    const secret = process.env.LOCAL_SESSION_SECRET;
    const token = createHmac("sha256", secret).update(`digest-off.v1.${who.id}`).digest("base64url").slice(0, 32);
    await internal(`/users/${who.id}`, { method: "PATCH", body: { emailDigest: true } });
    const forged = await fetch(`${SITE}/api/unsubscribe?u=${who.id}&t=${"A".repeat(32)}`, { method: "POST" });
    const otherUser = await fetch(`${SITE}/api/unsubscribe?u=1&t=${token}`, { method: "POST" });
    const getIt = await fetch(`${SITE}/api/unsubscribe?u=${who.id}&t=${token}`);
    const still = (await internal(`/users/${who.id}`)).json.emailDigest;
    const real = await fetch(`${SITE}/api/unsubscribe?u=${who.id}&t=${token}`, { method: "POST" });
    const after = (await internal(`/users/${who.id}`)).json.emailDigest;
    r.check("A-13", "forged or borrowed tokens fail; a GET does nothing; the real one-click POST works", forged.status === 404 && otherUser.status === 404 && still === true && real.status === 200 && after === false, {
      forged: forged.status,
      otherUser: otherUser.status,
      get: getIt.status,
      real: real.status,
    });
    const pageView = await fetch(`${SITE}/unsubscribe?u=${who.id}&t=${token}`);
    r.check("A-13b", "the /unsubscribe page asks with a button (scanners can't unsubscribe)", pageView.status === 200 && (await pageView.text()).includes("<form"), pageView.status);
  });

  await r.step("A-14", "changing the password", async () => {
    const other = await browser();
    await signInUi(other.page, who);
    const wrong = await call("changePassword", "not-the-password", "another-long-pass");
    const short = await call("changePassword", who.password, "short");
    const ok = await call("changePassword", who.password, "another-long-pass");
    const here = await me(B.page);
    const there = await me(other.page);
    r.check("A-14", "wrong current / short new refused; change keeps this device and ends the others", wrong.value?.ok === false && short.value?.ok === false && ok.value?.ok && here !== null && there === null, {
      wrong: wrong.value?.error,
      short: short.value?.error,
      thisDevice: Boolean(here),
      otherDevice: there,
    });
    who.password = "another-long-pass";
    await other.close();
  });

  await r.step("A-15", "export: the whole diary, private pages included", async () => {
    await writePage(who, { title: "Private one", visibility: "private" });
    await writePage(who, { title: "Draft one", visibility: "draft" });
    const ex = await call("exportDiary");
    const d = ex.value?.diary;
    const titles = d?.entries?.map((e) => e.title) ?? d?.pages?.map((e) => e.title) ?? [];
    r.check("A-15", "export has public, private and draft pages", ["Private one", "Draft one", "Before the move"].every((t) => JSON.stringify(d ?? {}).includes(t)), {
      keys: d ? Object.keys(d) : ex.raw,
      titles,
    });
    const leak = JSON.stringify(d ?? {}).match(/passwordHash|sessionVersion|ipHash|ip_hash/);
    r.check("A-15b", "export carries no password hash, session version or hashed IPs", !leak, leak?.[0]);
  });

  await r.step("A-16", "deleting the account", async () => {
    const writer = await makeMember("host");
    const hostPage = await writePage(writer, { title: "Host page", slug: "host" });
    await call("noteAsMember", hostPage.id, "a note that should outlive me");
    const wrong = await call("deleteAccount", "not my name");
    const meNow = await me(B.page);
    const right = await call("deleteAccount", meNow.displayName);
    const gone = await internal(`/users/${who.id}`);
    const notes = (await api(`/entries/${hostPage.id}/notes`)).json ?? [];
    const kept = notes.find((x) => x.body === "a note that should outlive me");
    const after = await me(B.page);
    r.check("A-16", "wrong name refused; right name deletes, signs out, and notes stay as 'a former reader'", wrong.value?.ok === false && gone.status === 404 && kept?.name === "a former reader" && after === null, {
      wrong: wrong.value?.error,
      right: right.status,
      account: gone.status,
      note: kept && { name: kept.name, member: kept.member },
      signedIn: after,
    });
    const login = await internal("/sign-in", { method: "POST", body: { email: who.email } });
    r.check("A-16b", "the address can't sign in any more", login.json?.user === null, login.json);
  });
  await B.close();
} finally {
  r.info("A-99", "browser problems", page.problems.slice(0, 12));
  r.save();
  await W.close();
}
