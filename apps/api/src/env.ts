import type { DB } from "./db/types";

export type Bindings = {
  DATABASE_URL: string;
  /** Bearer token the web app's server uses for author-only routes. */
  ADMIN_TOKEN: string;
  /** Comma-separated list of origins allowed to call the API from a browser. */
  WEB_ORIGIN: string;
  /** Salt for hashing visitor IPs; raw IPs are never stored. */
  IP_SALT?: string;
  /** When set, public writes must carry a valid Cloudflare Turnstile token. */
  TURNSTILE_SECRET?: string;
  LASTFM_API_KEY?: string;
  LASTFM_USER?: string;
};

export type AppEnv = { Bindings: Bindings; Variables: { db: DB } };
