// Helpers for the full local stack (API on PGlite at :8787, web `next start` at :3000), where everything may be
// tested: no Turnstile, the moderator's password is ours, and accounts can be made and destroyed freely.
// Needs LOCAL_ADMIN_TOKEN (the API's ADMIN_TOKEN) and LOCAL_ADMIN_PASSWORD from the environment.
import { randomBytes, scrypt } from "node:crypto";

export const SITE = process.env.SITE ?? "http://localhost:3000";
export const API = process.env.API ?? "http://localhost:8787";
const TOKEN = process.env.LOCAL_ADMIN_TOKEN;
/** A fresh visitor address each time, unless one is given: locally the API trusts cf-connecting-ip. */
export const newIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${((Math.random() * 250) | 0) + 1}`;

/** A guest's call straight to the API, as their browser makes it (with the site's origin). */
export async function api(path, { method = "GET", body, ip: from, origin = SITE, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: {
      origin,
      "cf-connecting-ip": from ?? newIp(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

/** The web server's own calls (only for setting up, or reading what the browser can't, like an email's token). */
export const internal = (path, opts = {}) =>
  api(`/internal${path}`, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) } });
export const adminApi = (path, opts = {}) =>
  api(`/admin${path}`, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) } });

/** The same scrypt format the web server stores, so accounts made here can sign in through the real form. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((ok, bad) =>
    scrypt(password.normalize("NFKC"), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 }, (e, key) =>
      e ? bad(e) : ok(`scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`),
    ),
  );
}

let n = 0;
/** A new member, made directly (fast); returns { id, handle, displayName, email, password }. */
export async function makeMember(prefix = "qa") {
  const tag = `${Date.now().toString(36).slice(-5)}${++n}`;
  const password = `pw-${tag}-long`;
  const email = `${prefix}${tag}@example.test`;
  const displayName = `${prefix} ${tag}`.slice(0, 24);
  const res = await internal("/users", {
    method: "POST",
    body: { email, displayName, passwordHash: await hashPassword(password) },
  });
  if (res.status !== 201) throw new Error(`could not make a member: ${res.status} ${res.text}`);
  return { ...res.json, email, password };
}

/** Signs a member in through the real Welcome screen. */
export async function signInUi(page, m) {
  await page.goto(`${SITE}/welcome`, 1500);
  await page.clickTextUntil("I have an account", `document.querySelector("#si-email")`, ".wl-tile");
  await page.fill("#si-email", m.email);
  await page.fill("#si-password", m.password);
  await page.click(".wl-form button[type=submit]");
  await page.waitFor(`location.pathname !== "/welcome" || document.querySelector(".wl-error")?.innerText`, 20000);
  const err = await page.eval(`document.querySelector(".wl-error")?.innerText ?? null`);
  if (err) throw new Error(`sign-in refused: ${err}`);
  await new Promise((r) => setTimeout(r, 1200));
}

/** Writes a page for a member straight through the API (setting up); returns the saved entry. */
export async function writePage(m, page) {
  const res = await internal(`/users/${m.id}/entries`, {
    method: "POST",
    body: { body: "words", ...page },
  });
  if (res.status !== 201) throw new Error(`could not write: ${res.status} ${res.text}`);
  return res.json;
}
