// A read-only load test: readers opening the front page, a diary page, and what the desktop fetches after it loads.
// Run it with k6 (https://k6.io, `brew install k6`):
//
//   k6 run scripts/load-test.js                        # against https://2die429.com, about 5 minutes
//   k6 run -e PEAK=100 scripts/load-test.js            # more readers at the peak
//   k6 run -e SITE=http://localhost:3000 -e API=http://localhost:8787 scripts/load-test.js
//
// It never writes anything (no notes, lines or pages: those are rate-limited and need Turnstile anyway).
// Mind the free plans before raising PEAK or the duration: Cloudflare Workers allows 100,000 API requests a day, and
// a run at the default peak sends about 3,000 (and about 1,200 page loads to Vercel).

import { check, sleep } from "k6";
import http from "k6/http";

const SITE = __ENV.SITE || "https://2die429.com";
const API = __ENV.API || "https://api.2die429.com";
const PEAK = Number(__ENV.PEAK || 50);

export const options = {
  stages: [
    { duration: "1m", target: Math.round(PEAK / 2) },
    { duration: "3m", target: PEAK },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:page}": ["p(95)<1500"],
    "http_req_duration{kind:api}": ["p(95)<800"],
  },
};

// The night in Vietnam ("2026-10-23"), as the desktop asks for it.
function night() {
  const vn = new Date(Date.now() + 7 * 3600_000);
  if (vn.getUTCHours() < 6) vn.setUTCDate(vn.getUTCDate() - 1);
  return vn.toISOString().slice(0, 10);
}

export function setup() {
  const pages = http.get(`${API}/entries?limit=20`).json() || [];
  return { pages: pages.map((p) => `/u/${p.author.handle}/${p.slug}`) };
}

export default function ({ pages }) {
  const page = { tags: { kind: "page" } };
  const api = { tags: { kind: "api" } };
  const n = night();

  // The front page, then what the desktop asks for once it has loaded.
  check(http.get(`${SITE}/`, page), { "front page": (r) => r.status === 200 });
  http
    .batch([
      ["GET", `${API}/entries?limit=30`, null, api],
      ["GET", `${API}/nights/${n}/sky`, null, api],
      ["GET", `${API}/nights/${n}/plan`, null, api],
      ["GET", `${API}/entries?prompt=${n}&limit=30`, null, api],
    ])
    .forEach((r) => {
      check(r, { "api 200": (x) => x.status === 200 });
    });
  sleep(2 + Math.random() * 4);

  // A diary page, read for a while.
  if (pages.length) {
    const href = pages[Math.floor(Math.random() * pages.length)];
    check(http.get(`${SITE}${href}`, page), { "diary page": (r) => r.status === 200 });
    sleep(5 + Math.random() * 10);
  }

  // Now and then, the poem or a random page.
  if (Math.random() < 0.3) http.get(`${API}/nights/${n}/lines`, api);
  if (Math.random() < 0.2) http.get(`${API}/entries/random`, api);
  sleep(1 + Math.random() * 3);
}
