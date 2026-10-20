# 4me

A night diary on a 2006 desktop. One entry after dark, with the mood, the weather and the song that was playing.
Readers leave notes in a Messenger window, BUZZ the author, sign a shoutbox guestbook, flip through the photos, peek
at the lines that were *almost* posted, and look after **Ink**, the black cat who lives on the taskbar. They can stay
anonymous or log on at an XP-style Welcome screen (email and password, or Google) to keep their name, a picture and
their own Ink on every device.

```
apps/web      Next.js 16 (App Router) · the desktop, the author's /admin, RSS      → Vercel
apps/api      Hono 4 on Cloudflare Workers · Drizzle ORM · Neon Postgres            → Cloudflare
packages/shared  zod schemas, types and the diary's tiny markup, used by both
design/       the prototypes and research that led here (not deployed)
```

## Run it locally

Needs Node 22+ and pnpm (`corepack enable`). No cloud account is needed: locally the API runs on Node with
[PGlite](https://pglite.dev) (Postgres in WASM, stored in `apps/api/.pglite`) and seeds a few sample nights.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local     # set ADMIN_PASSWORD and ADMIN_SESSION_SECRET
pnpm dev                                          # api on :8787, web on :3000
```

Open http://localhost:3000. Write at http://localhost:3000/admin with the password from `.env.local`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | API (Node + PGlite) and web together |
| `pnpm test` | Unit and API tests (the API tests run against an in-memory PGlite) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | TypeScript, Biome lint, Biome format |
| `pnpm build` | Next.js production build and a dry-run bundle of the Worker |
| `pnpm db:generate` | Write a new SQL migration after editing `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm --filter @4me/api db:seed` | Put the sample nights into an empty `DATABASE_URL` |

## Writing

The author logs in at `/admin`. A page has a title, the night itself, mood, weather, the time it was written,
a song link (Spotify, YouTube or SoundCloud; the API resolves title, cover and an embeddable player), photos
(`url | caption`, one per line) and who can read it (everyone, only me, draft).

The body uses a small markup that never produces raw HTML:

| Write | Get |
| --- | --- |
| a blank line | a new paragraph |
| `~~I thought about calling you.~~` | crossed out, the things almost said |
| `_words_` | italic |
| `> it will rain again tomorrow.` | a handwritten note in amber |
| `[photo 2]` | the second photo, inline |

Blasts (the Yahoo 360-style status line) and "Almost posted" lines are managed from the same page, along with
notes held for review (anything with a link waits for approval).

## Accounts

`/welcome` is the log-on screen: Guest, *I have an account*, *Create a new account*, and *Continue with Google*
when it is configured. Signed-in readers write under their own name with their picture, and nobody else (signed in or
not) can use that name or the author's. *Start → My account* changes the picture and name, lists the reader's notes,
changes or sets a password, logs off on every device, or deletes the account (their notes stay, signed
"a former reader").

How it is built: the **web server** does the authentication (scrypt hashing, Google's code flow with PKCE, the session
cookie on its own domain) and the **API** stores accounts behind `/internal/*`, which only accepts the server token.
Pages stay cacheable: the desktop asks `/me` who is signed in after it renders.

## Ink

Per visitor, Ink has two needs that drift over time, kept in the visitor's browser: **fed** and **happy**.
Every pet, fish and game is also counted for everyone on the API (`/cat`).

- Click to pet. Press and drag across her to stroke her (purrs after a few strokes).
- Right-click, long-press, or Shift+F10 opens her menu: give a fish (a bowl appears, she runs to it and eats),
  play with the yarn (she chases it three times), pet, call her over. The Start menu has the same actions.
- A reader's note or shout earns her a snack. A BUZZ makes her jump.
- She sleeps by day (the diary is awake from 17:00 to 06:00 in the reader's own time), begs at the Start button
  when hungry, and asks for attention when lonely.
- Her pixel art lives in `apps/web/components/ink/sprites.ts` as letter maps; edit the letters to redraw her.

## Deploy

`main` deploys automatically: **CI → migrate Neon → deploy the Worker → deploy the web app**. Pull requests run
CI and get a Vercel preview.

### One-time setup

1. **Neon**: create a project and copy its connection string (`DATABASE_URL`). Optionally seed it:
   `DATABASE_URL=... pnpm db:migrate && DATABASE_URL=... pnpm --filter @4me/api db:seed`.
2. **Cloudflare**: create an API token with the *Edit Cloudflare Workers* template; note your account ID.
   Optional secrets are set once by hand:
   `pnpm --filter @4me/api exec wrangler secret put TURNSTILE_SECRET` and `... LASTFM_API_KEY`.
3. **Vercel**: import the repository, set **Root Directory** to `apps/web`, and add the web environment
   variables below. If you deploy from GitHub Actions (as configured), turn off Vercel's own Git deployments
   to avoid building twice. Run `pnpm dlx vercel link` once locally to get the org and project IDs from
   `.vercel/project.json`.
4. **GitHub** → Settings → Environments → `production` (and `preview` for pull requests):

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
| `ADMIN_PASSWORD` | the author's password |
| `ADMIN_SESSION_SECRET` | 16+ random characters for signing the session cookie |
| `ADMIN_TOKEN` | same as the API's; also authorises the account calls to `/internal/*` |
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
- **Privacy.** Raw IPs are never stored (salted hashes only); emails are never shown; deleting an account deletes it.

## How it holds up

- Reads are cached at three levels: `Cache-Control` from the API, Next.js ISR (15–60 s), and the CDN.
- The Worker has no cold start and scales with traffic; Neon is reached over HTTP, so there are no
  connection pools to exhaust. The list query uses an index on `(visibility, written_at)`.
- Public writes are validated with zod, rate limited per hashed IP in Postgres (so limits hold across Worker
  isolates), optionally gated by Turnstile, and anything with a link is held for review. Raw IPs are never stored.
- The author's token never reaches a browser: `/admin` runs on the web server and calls the API with it.

## Next

- Photo uploads to Cloudflare R2 instead of pasting URLs.
- Live BUZZ and "reading now" between readers (Durable Objects or a small WebSocket service).
- More of Ink: a name tag, seasonal outfits, a ball of wool that stays where you left it.
