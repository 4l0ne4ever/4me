import type { DB } from "./db/types";
import type { MediaStore } from "./lib/media";

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
  /** Whose listening the front desktop shows when the page on it has no Last.fm of its own. */
  LASTFM_USER?: string;
  /** The photo bucket, any S3-compatible store (AWS S3 or Cloudflare R2). Without it, uploads are switched off. */
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
};

/** `clientIp` is set only for calls from the web server, which forwards the reader's real address. */
export type AppEnv = { Bindings: Bindings; Variables: { db: DB; media: MediaStore | null; clientIp?: string } };
