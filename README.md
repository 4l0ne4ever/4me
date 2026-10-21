# 4me

Night diaries on a 2006 desktop. Anyone with an account keeps one: a page after dark, with the mood, the weather,
a song picked from the music search (it plays a 30-second preview, like a song sticker) and photos from their phone.
Each writer has a desktop of their own at `/u/<handle>`; the front desktop belongs to nobody: it opens no one's
page, and shows everyone's newest pages in a *Tonight* window, the newest notes on every diary in its Messenger
(live, from `GET /entries/notes/recent` and the `notes` topic) and the shared guestbook. Readers leave notes in a Messenger window, BUZZ the writer, sign guestbooks, flip through the
photos, peek at the lines that were *almost* posted, and look after **Ink**, the black cat who lives on the taskbar.
Guests can read and leave notes; logging on at the XP-style Welcome screen (email and password, or Google) keeps a
name, a picture and Ink on every device, and opens the Notepad to write.

```
apps/web      Next.js 16 (App Router) · the desktop, the author's /admin, RSS      → Vercel
apps/api      Hono 4 on Cloudflare Workers · Drizzle ORM · Neon Postgres            → Cloudflare
packages/shared  zod schemas, types and the diary's tiny markup, used by both
design/       the prototypes and research that led here (not deployed)
```

## Run it locally

Needs Node 22+ and pnpm (`corepack enable`). No cloud account is needed: locally the API runs on Node with
[PGlite](https://pglite.dev) (Postgres in WASM, stored in `apps/api/.pglite`) and seeds two sample writers and a
few nights. Photos stay in memory unless `apps/api/.env` names a bucket (the same `S3_*` settings as production).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local     # set ADMIN_PASSWORD and ADMIN_SESSION_SECRET
pnpm dev                                          # api on :8787, web on :3000
```

Open http://localhost:3000, create an account at `/welcome` and open **Write**. Moderate at
http://localhost:3000/admin with the password from `.env.local`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | API (Node + PGlite) and web together |
| `pnpm test` | Unit and API tests (the API tests run against an in-memory PGlite) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | TypeScript, Biome lint, Biome format |
| `pnpm build` | Next.js production build and a dry-run bundle of the Worker |
| `pnpm db:generate` | Write a new SQL migration after editing `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm --filter @4me/api db:seed` | Put the sample writers and nights into an empty `DATABASE_URL` |

## Writing

Any member opens **Write** (desktop icon or Start menu). The Notepad has four tabs:

- **New page / Editing**: title, the night itself, mood, weather, the time it was written, a song, up to 12 photos,
  who can read it (everyone, only me, draft) and an optional address (`/u/<handle>/<slug>`).
- **My pages**: every page of theirs, private ones and drafts included, to open, edit or delete.
- **Blast & bin**: the one-line status on their Messenger, and lines for their Almost posted bin.
- **Notes**: notes other people left on their pages. Anything with a link waits here until they show it.

The Diary shows *Edit this page* to its writer and *report* to everyone else.

**Songs** come from the iTunes Search API (free, no key). The reader's browser asks Apple directly (Apple allows it
from any site, and turns many cloud servers away, Cloudflare's included); the API only checks that every link of a
picked song is one of Apple's own (`*.apple.com`, `*.mzstatic.com`) before storing it. Songs play their 30-second
preview on the page. The Mixtape plays whole songs through YouTube's embedded player: the API looks each song up
once with the YouTube Data API (`GET /music/video`, key kept as the Worker secret `YOUTUBE_API_KEY`) and remembers
the answer in `song_videos`, so the free quota (about 100 searches a day) goes a long way. Without the key, or when
no video is found, it falls back to the preview. A writer who linked Last.fm also has what they are playing now
and their last ten different songs in their Mixtape (`GET /recent-tracks`). Only the song about to play is looked up
on YouTube, to spare the quota.

**Photos** are shrunk in the browser to 2048 px JPEG (which also applies their rotation and drops EXIF and GPS),
then sent straight to the API with a ten-minute upload ticket signed by the web server. The API checks it is a JPEG,
strips every metadata segment again, and stores it in the photo bucket. Limits: 4 MB a photo, 60 a day, 300 MB per
member. Deleting a page, or an account, deletes its photos.

The body uses a small markup that never produces raw HTML:

| Write | Get |
| --- | --- |
| a blank line | a new paragraph |
| `~~I thought about calling you.~~` | crossed out, the things almost said |
| `_words_` | italic |
| `> it will rain again tomorrow.` | a handwritten note in amber |
| `[photo 2]` | the second photo, inline |

## One computer, everyone's diaries

Whoever is reading is always on their own computer: their wallpaper, skin, Ink, Notepad and notifications. Opening
someone's diary opens *their* windows on it, each titled with their name (`Lan — The last tram.doc`, `Messenger —
Lan`, `Lan's guestbook`). The taskbar has a 2006 address bar: Back, Home (Tonight, the front page) and the address of
what's open, `4me://lan/the-last-tram`; type a name and press Enter to go to that diary. A link with `?open=guest`
opens a window straight away (notifications use it).

Moving between pages never reloads anything: the computer (wallpaper, Ink, taskbar, open windows, the live
connection) lives in the shared layout `app/(desk)/layout.tsx`, and each page only swaps the windows that show it
(`DeskPage`). Links start loading when pointed at, the cursor turns into an hourglass while a page loads, and diary
pages are built once and cached (refreshed every 30 seconds, or straight after a change).

## Notes, replies and reactions

Under every page: its notes, each with a *reply* (one level deep; replying to a reply answers the same thread) and
reactions. A page and every note take one reaction per reader, from six 2006 smileys (❤️ 🤗 😂 😮 😢 🌙); picking the
same one again takes it back. Members are counted by account, guests by hashed IP. A note's writer, or the page's
writer, can delete it with its replies. Notes, replies, reactions and deletions reach everyone reading the page live;
the person replied to, the page's writer and a note's writer are notified.

## Subscriptions, search, editing

A blog, not a social network, so the extras stay quiet:

- **Subscribe** to a diary (next to its writer's name): its new public pages ring your bell and fill the
  *Subscriptions* tab in Tonight, your reading list. Nobody is told who subscribed; a diary only shows how many.
- **Search** (desktop icon, Start menu, or type anything that isn't a diary's address into the address bar) finds
  diaries by name or address and public pages by their words, with or without Vietnamese accents.
- A note's writer can **edit** it (it says "edited"; adding a link sends it back for approval) and anyone can
  **report** a note: three different readers hide it until the moderator looks (`/admin`, Reported notes).
- **Notepad keeps unsaved work** in the browser as you type, per page, and offers it back next time
  ("You have unsaved changes from 21:04. Restore them · Throw them away").

## Things only 4me does

- **Sealed letters.** In Notepad, *A letter to the future* seals a page until a date (up to ten years). Readers see
  an envelope with a wax seal and a countdown; its words, song and photos stay with its writer, and it can't be
  answered or found by search. On the day it opens by itself, right on screen for anyone reading, and a cron on the
  Worker (every ten minutes) tells its writer and subscribers.
- **The archive is a night sky.** *Archive* shows a diary month by month, each page a star: across by the day,
  up by how late in the night it was written (17:00 at the horizon, 06:00 at the top), brighter the more it was
  answered. Above it, *On this night*: pages written on this date in earlier years, and *Nights by mood*: pick a mood
  (or press a page's "Current mood") to gather every night written in it, from every month. The same pages are
  listed below in plain text.
- **Lit windows.** A row of tube houses across the street sits at the foot of the desktop, with one lit window for
  everyone with 4me open right now (only a count; nobody is named). Hover or tap it to read what the lights mean.
- **Link previews** are drawn per page, diary and front page as a 2006 window with the date, title, mood, a few
  words, the song and the first photo (`opengraph-image.tsx`, fonts in `app/og-fonts`, Vietnamese included).

## Live updates and notifications

Every page keeps one WebSocket to the API (`/live`) for its topics: the open page (`entry:<id>`: notes, BUZZes and
how many are reading), the guestbook on screen (`guest:<handle>`), new public pages (`tonight`) and, signed in, the
member's own notifications (`user:<id>`, only with a ten-minute ticket the web server signs). New notes and shouts
appear without reloading, a BUZZ shakes everyone reading the page, Tonight fills in as people post.

Notifications (a note or a held note on your page, a reply to your note, a reaction, a shout in your guestbook, a
BUZZ, a new page in a diary you subscribed to) are stored, so the tray's bell shows what you missed; new ones pop up as a Windows XP balloon with a chime, and,
if you switch it on in the bell menu, as a notification from your own computer while the tab is in the background.

On Workers, the connections live in one Durable Object (`Hub`, SQLite-backed, so it runs on the free plan) using the
hibernation API: it sleeps when nothing is happening and answers pings without waking. Locally, `pnpm dev` keeps them
in the Node process with the same rules.

## Moderation

The site's moderator logs in at `/admin` with `ADMIN_PASSWORD`. Members write their own pages; the moderator sees
pages readers reported (with the reasons), hides or keeps them up, suspends or restores accounts, and approves held
notes and shouts. A page reported by three different readers (one per account, or per hashed IP for guests) is
hidden until the moderator looks; *Keep up* clears its reports. A suspended member can still sign in, read and delete
their own pages, but can't write, and their desktop is closed.

## Accounts

`/welcome` is the log-on screen: Guest, *I have an account*, *Create a new account*, and *Continue with Google*
when it is configured. Every account gets a desktop address made from its name (`Đêm mưa` → `/u/dem_mua`).
Signed-in readers write under their own name with their picture, and nobody else (signed in or not) can use that
name. *Start → My account* changes the picture, name, desktop address, the line about them and their Last.fm
username, lists their notes, changes or sets a password, downloads the whole diary as a zip (every page as Markdown,
private ones too, with photos, notes, blasts, the bin and the guestbook, plus `diary.json`; the browser packs it from
`/internal/users/:id/export`), logs off on every device, or deletes the account (with
their pages and photos; notes on other people's pages stay, signed "a former reader").

How it is built: the **web server** does the authentication (scrypt hashing, Google's code flow with PKCE, the session
cookie on its own domain) and the **API** stores accounts behind `/internal/*`, which only accepts the server token.
Pages stay cacheable: the desktop asks `/me` who is signed in after it renders.

## Ink

Per visitor, Ink has two needs that drift over time, kept in the visitor's browser: **fed** and **happy**.
Every pet, fish and game is also counted for everyone on the API (`/cat`).

- Click to pet. Press and drag across her to stroke her (purrs after a few strokes).
- Right-click, long-press, or Shift+F10 opens her menu: give a fish (a bowl drops in front of her and she eats it),
  play with the yarn (she chases it three times), pet, call her over. The Start menu has the same actions.
- Right-click the empty desktop → *Drop a fish here*: the bowl falls from that point onto whatever is below it (a
  window, a roof across the street, or the taskbar), and she finds her way there.
- She walks about, and now and then climbs up the side of a window or a house to sit on top, walk along it, or
  nap there. Drag the window and she rides along; close or minimise it and she drops to whatever is below. Every
  surface comes from the page itself (`components/ink/world.ts`); on phones she keeps to the taskbar.
- A reader's note or shout earns her a snack. A BUZZ makes her jump.
- She sleeps by day (the diary is awake from 17:00 to 06:00 in the reader's own time), begs at the Start button
  when hungry, and asks for attention when lonely.
- Her pixel art lives in `apps/web/components/ink/sprites.ts` as letter maps; edit the letters to redraw her.

## Deploy

`main` deploys automatically: **CI → migrate Neon → deploy the Worker → deploy the web app**. Pull requests run
CI only; preview the web app locally with `pnpm dev`.

### One-time setup

1. **Neon**: create a project and copy its connection string (`DATABASE_URL`). Optionally seed it:
   `DATABASE_URL=... pnpm db:migrate && DATABASE_URL=... pnpm --filter @4me/api db:seed`.
2. **Cloudflare**: create an API token with the *Edit Cloudflare Workers* template; note your account ID.
   Optional secrets are set once by hand, in the dashboard (Workers & Pages → 4me-api → Settings → Variables and
   Secrets) or with `pnpm --filter @4me/api exec wrangler secret put <NAME>`: `TURNSTILE_SECRET`, `LASTFM_API_KEY`,
   `YOUTUBE_API_KEY` (Google Cloud → enable *YouTube Data API v3* → Credentials → API key, restricted to that API).
3. **Photo bucket** (any S3-compatible store; without it, photo uploads are switched off). Set four Worker secrets
   the same way:

   | Secret | Cloudflare R2 | Amazon S3 |
   | --- | --- | --- |
   | `S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com/<bucket>` | `https://<bucket>.s3.<region>.amazonaws.com` |
   | `S3_REGION` | `auto` | the bucket's region, e.g. `ap-southeast-1` |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | an R2 API token with *Object Read & Write* on that bucket | an IAM user allowed only `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on that bucket |

   Keep the bucket private (no public access): photos are served through the API at `/media/…`.
4. **Vercel**: import the repository, set **Root Directory** to `apps/web`, and add the web environment
   variables below. If you deploy from GitHub Actions (as configured), turn off Vercel's own Git deployments
   to avoid building twice. Run `pnpm dlx vercel link` once locally to get the org and project IDs from
   `.vercel/project.json`.
5. **GitHub** → Settings → Environments → `production`:

| Kind | Name | Value |
| --- | --- | --- |
| secret | `DATABASE_URL` | Neon connection string |
| secret | `ADMIN_TOKEN` | a long random string, the same one Vercel's `ADMIN_TOKEN` has |
| secret | `IP_SALT` | a random string used to hash visitor IPs |
| secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | from step 2 |
| secret | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | from step 3 |
| variable | `SITE_URL` | the web address, e.g. `https://4me.vercel.app` (also the API's allowed origin) |
| variable | `API_URL` | the Worker address, e.g. `https://4me-api.<you>.workers.dev` |
| variable | `LASTFM_USER` | your Last.fm username, for the "listening now" line (optional) |

### Web environment (Vercel)

| Name | |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | the Worker address |
| `NEXT_PUBLIC_SITE_URL` | the web address |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional; when set (with the API's `TURNSTILE_SECRET`) public writes need Turnstile |
| `ADMIN_PASSWORD` | the moderator's password for `/admin` |
| `ADMIN_SESSION_SECRET` | 16+ random characters for signing the session cookie |
| `ADMIN_TOKEN` | same as the API's; authorises the account and writing calls to `/internal/*` and signs upload tickets |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`) for signing readers' sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional, for *Continue with Google* |
| `RESEND_API_KEY`, `MAIL_FROM` | optional, for password-reset emails; without them the "forgot" link is hidden |

**Google sign-in**: in Google Cloud Console → APIs & Services → Credentials, create an *OAuth client ID* (Web
application). Authorised JavaScript origin: your `SITE_URL`. Authorised redirect URI:
`https://<your site>/auth/google/callback` (Google refuses plain http except for localhost). Scopes used:
`openid email profile`.

## Security

- **HTTPS everywhere.** Vercel and Workers only serve HTTPS. Both apps send HSTS (`max-age` two years,
  `includeSubDomains; preload`); the web app upgrades any stray `http://` load once it is served over HTTPS; the API
  only accepts `https://` origins (plus `localhost` in development); Google's callback must be HTTPS.
- **Sessions.** A signed (HMAC-SHA256), expiring token in a `__Host-` cookie: `Secure`, `HttpOnly`,
  `SameSite=Lax`, this host only. Each account has a session version; changing or resetting the password, or
  *Log off on every device*, bumps it and every older cookie stops working.
- **Passwords.** scrypt (N=2¹⁵, r=8, p=1, 16-byte salt), compared in constant time, hashed on the web server and
  stored only as the hash. Sign-in runs the hash even for unknown addresses and answers "Wrong email or password"
  either way. Sign-in is limited per IP and per address; sign-up, resets and every public write are rate limited too.
- **Reset links.** 256-bit random, stored only as a SHA-256, one hour, single use; requesting one says the same thing
  whether or not the address exists; the reset page sends no referrer.
- **Google.** Authorization code flow with PKCE (S256) and a one-time `state` in a short-lived `__Host-` cookie;
  issuer, audience and expiry are checked; an existing account is only linked when Google says the email is verified.
- **Requests.** Server Actions check the Origin header; redirects after log-on only go to same-site paths; inputs are
  validated with zod on both sides; the author's and the server token never reach a browser; error logs never include
  query parameters.
- **Headers.** A Content-Security-Policy pinned to the hosts the site uses, `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, COOP, and a locked-down Permissions-Policy.
- **Members' content.** A member can only read back, edit or delete their own pages, blasts, bin and notes inbox;
  every member route takes the id from the signed session, never from the browser. Photos on a page must be that
  member's own uploads; upload tickets are HMAC-signed, last ten minutes and name one member.
- **Photos.** JPEG only, metadata stripped twice (browser and API), stored in a private bucket, served with
  `nosniff` and a `default-src 'none'` CSP.
- **Privacy.** Raw IPs are never stored (salted hashes only); emails are never shown; deleting an account deletes it,
  with its pages and photos.

## How it holds up

- Reads are cached at three levels: `Cache-Control` from the API, Next.js ISR (15–60 s), and the CDN.
- The Worker has no cold start and scales with traffic; Neon is reached over HTTP, so there are no
  connection pools to exhaust. The list query uses an index on `(visibility, written_at)`.
- Public writes are validated with zod, rate limited per hashed IP in Postgres (so limits hold across Worker
  isolates), optionally gated by Turnstile, and anything with a link is held for review. Raw IPs are never stored.
- The server token never reaches a browser: `/admin` and every member action run on the web server and call the
  API with it; photo uploads carry a short-lived ticket instead.
- The photo bucket is reached over S3's API, so moving between Cloudflare R2 and Amazon S3 is a change of secrets.

## Next

- Song stickers on notes and guestbook shouts.
- Live BUZZ and "reading now" between readers (Durable Objects or a small WebSocket service).
- More of Ink: a name tag, seasonal outfits, a ball of wool that stays where you left it.
