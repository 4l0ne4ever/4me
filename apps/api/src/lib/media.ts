import { AwsClient } from "aws4fetch";
import type { Bindings } from "../env";

/** Where uploaded photos live. Production talks S3 (AWS S3 or Cloudflare R2); development and tests keep them here. */
export interface MediaStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream | Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Any S3-compatible bucket. `S3_ENDPOINT` already addresses the bucket:
 *   AWS S3         https://<bucket>.s3.<region>.amazonaws.com
 *   Cloudflare R2  https://<account id>.r2.cloudflarestorage.com/<bucket>
 */
export function s3Store(env: Bindings): MediaStore | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  const base = env.S3_ENDPOINT.replace(/\/+$/, "");
  const aws = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.S3_REGION || "auto",
  });
  const url = (key: string) => `${base}/${key}`;
  return {
    async put(key, body, contentType) {
      const res = await aws.fetch(url(key), {
        method: "PUT",
        body,
        headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
      });
      if (!res.ok) throw new Error(`storage put ${res.status}`);
    },
    async get(key) {
      const res = await aws.fetch(url(key));
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok || !res.body) throw new Error(`storage get ${res.status}`);
      return { body: res.body, contentType: res.headers.get("content-type") ?? "image/jpeg" };
    },
    async delete(key) {
      const res = await aws.fetch(url(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete ${res.status}`);
    },
  };
}

/** Kept in memory: tests, and local work when no bucket is configured. */
export function memoryStore(): MediaStore {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    async put(key, body, contentType) {
      files.set(key, { body, contentType });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 6000;

/**
 * Checks that the bytes are a JPEG and returns them without metadata: every APP1–APP15 segment (EXIF with GPS,
 * XMP, maker notes) and comments are dropped. The browser already re-encodes photos, so this is the safety net
 * for anything that skipped it. Returns null for anything that is not a well-formed JPEG of a sensible size.
 */
export function cleanJpeg(input: Uint8Array): { bytes: Uint8Array; width: number; height: number } | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const out: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let pos = 2;
  while (pos < input.length) {
    if (input[pos] !== 0xff) return null;
    let markerAt = pos;
    while (input[markerAt + 1] === 0xff) markerAt++; // fill bytes
    const marker = input[markerAt + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) {
      out.push(input.subarray(markerAt, markerAt + 2));
      break;
    }
    if (marker === 0xda) {
      // Start of scan: the compressed image follows; keep the rest as it is.
      out.push(input.subarray(markerAt));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(input.subarray(markerAt, markerAt + 2));
      pos = markerAt + 2;
      continue;
    }
    const length = ((input[markerAt + 2] ?? 0) << 8) | (input[markerAt + 3] ?? 0);
    const end = markerAt + 2 + length;
    if (length < 2 || end > input.length) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && length >= 7) {
      height = ((input[markerAt + 5] ?? 0) << 8) | (input[markerAt + 6] ?? 0);
      width = ((input[markerAt + 7] ?? 0) << 8) | (input[markerAt + 8] ?? 0);
    }
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) out.push(input.subarray(markerAt, end));
    pos = end;
  }
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
  const bytes = new Uint8Array(out.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of out) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, width, height };
}
