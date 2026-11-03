// A tiny Chrome DevTools Protocol driver: no dependencies, only the Chrome installed on this Mac and Node 22+.
// Each browser() is a separate Chrome with its own fresh profile, so two members can be signed in side by side.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function browser({ width = 1366, height = 820, mobile = false } = {}) {
  const dir = mkdtempSync(join(process.env.TESTER_TMP ?? tmpdir(), "4me-qa-"));
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try {
      port = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n")[0];
    } catch {}
  }
  if (!port) throw new Error("Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === "page");
  const page = await Page.connect(pageTarget.webSocketDebuggerUrl);
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  if (mobile)
    await page.send("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
  return {
    page,
    async close() {
      page.ws.close();
      proc.kill();
      await sleep(300);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class Page {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, bad) => {
      ws.onopen = ok;
      ws.onerror = bad;
    });
    const p = new Page(ws);
    await p.send("Page.enable");
    await p.send("Runtime.enable");
    await p.send("Network.enable");
    await p.send("Log.enable");
    return p;
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    /** What went wrong while the page ran: console errors, uncaught exceptions, failed or 4xx/5xx requests. */
    this.problems = [];
    /** Every API response seen, for timings and statuses. */
    this.responses = [];
    this.requests = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, bad } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? bad(new Error(`${msg.error.message}`)) : ok(msg.result);
        return;
      }
      this.onEvent(msg.method, msg.params);
      for (const l of this.listeners) l(msg.method, msg.params);
    };
  }

  onEvent(method, p) {
    if (method === "Runtime.exceptionThrown")
      this.problems.push({
        kind: "exception",
        text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text,
      });
    if (method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert"))
      this.problems.push({
        kind: "console",
        text: p.args
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 400),
      });
    if (method === "Network.requestWillBeSent")
      this.requests.set(p.requestId, { url: p.request.url, method: p.request.method, t: p.timestamp });
    if (method === "Network.responseReceived") {
      const r = this.requests.get(p.requestId);
      const entry = {
        url: p.response.url,
        status: p.response.status,
        method: r?.method,
        ms: r ? Math.round((p.timestamp - r.t) * 1000) : null,
      };
      this.responses.push(entry);
      if (p.response.status >= 400)
        this.problems.push({ kind: "http", text: `${entry.method} ${entry.status} ${entry.url}` });
    }
    if (method === "Network.loadingFailed" && !p.canceled) {
      const r = this.requests.get(p.requestId);
      this.problems.push({ kind: "network", text: `${r?.method} ${r?.url} ${p.errorText}` });
    }
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    // Nothing waits forever: a call that never answers (a page that navigated mid-call) fails after a minute.
    return new Promise((ok, bad) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        bad(new Error(`no answer to ${method} within 60 s`));
      }, 60000);
      this.pending.set(id, { ok: (v) => (clearTimeout(t), ok(v)), bad: (e) => (clearTimeout(t), bad(e)) });
    });
  }

  waitEvent(name, timeout = 30000) {
    return new Promise((ok, bad) => {
      const t = setTimeout(() => bad(new Error(`timeout waiting for ${name}`)), timeout);
      const l = (m, p) => {
        if (m === name) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          ok(p);
        }
      };
      this.listeners.push(l);
    });
  }

  async goto(url, settle = 1500) {
    const loaded = this.waitEvent("Page.loadEventFired", 45000);
    const started = Date.now();
    await this.send("Page.navigate", { url });
    await loaded;
    const ms = Date.now() - started;
    await sleep(settle);
    return ms;
  }

  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: typeof expr === "function" ? `(${expr})()` : expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Waits until the expression is truthy; returns its value. */
  async waitFor(expr, timeout = 15000, label = expr) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        // A DOM node can't be sent back by value; count it as "found".
        const v = await this.eval(`(() => { const v = (${expr}); return v instanceof Node ? true : v; })()`);
        if (v) return v;
      } catch {}
      await sleep(250);
    }
    throw new Error(`timeout: ${label}`);
  }

  /** Sets an input or textarea the way React notices. */
  fill(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no field " + ${JSON.stringify(selector)});
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  click(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("nothing to click: " + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
  }

  /** Clicks the first visible element (of `within`) whose text contains `text`. */
  clickText(text, within = "button, a, [role=tab], [role=menuitem], label, li") {
    return this.eval(`(() => {
      const want = ${JSON.stringify(text)}.toLowerCase();
      const all = [...document.querySelectorAll(${JSON.stringify(within)})];
      const el = all.find((e) => e.offsetParent !== null && (e.innerText || e.getAttribute("aria-label") || e.title || "").toLowerCase().includes(want))
        ?? all.find((e) => (e.innerText || e.getAttribute("aria-label") || e.title || "").toLowerCase().includes(want));
      if (!el) throw new Error("no element with text: " + ${JSON.stringify(text)});
      el.scrollIntoView({ block: "center" });
      el.click();
      return (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60);
    })()`);
  }

  /** Clicks (by text) until `expr` is truthy: a click before React hydrates does nothing, so it is tried again. */
  async clickTextUntil(text, expr, within, tries = 8) {
    for (let i = 0; i < tries; i++) {
      await this.clickText(text, within).catch(() => null);
      try {
        return await this.waitFor(expr, 1500);
      } catch {}
    }
    throw new Error(`clicking "${text}" never led to ${expr}`);
  }

  text(selector = "body") {
    return this.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`);
  }

  async screenshot(path) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  }

  /** Calls the site's API from inside the page, with the page's origin (and cookies, for same-site calls). */
  fetchJson(url, init = {}) {
    return this.eval(
      `fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}).then(async (r) => ({ status: r.status, body: await r.text() }))`,
    );
  }

  /** Puts local files into an <input type=file>, as if picked. */
  async upload(selector, paths) {
    const { root } = await this.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no file input ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId, files: paths });
  }

  async key(key, code = key, keyCode = 0) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
  }
}
