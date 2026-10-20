# 4me

A night diary on a 2006 desktop. One entry after dark, with the mood, the weather and the song that was playing.
Readers leave notes in a Messenger window, BUZZ the author, sign a shoutbox guestbook, flip through the photos, peek
at the lines that were *almost* posted, and look after **Ink**, the black cat who lives on the taskbar.

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
| `ADMIN_TOKEN` | same as the API's |

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
