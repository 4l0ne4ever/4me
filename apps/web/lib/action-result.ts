import { ApiError } from "./auth";

/** What a server action hands back to the window that called it. */
export type Fail = { ok: false; error: string; field?: string };
export type Ok<T> = { ok: true } & T;

export const fail = (e: unknown): Fail =>
  e instanceof ApiError
    ? { ok: false, error: e.message, field: e.field }
    : { ok: false, error: "something went wrong, try again in a moment" };
export const signedOut: Fail = { ok: false, error: "you've been signed out, sign in again" };
