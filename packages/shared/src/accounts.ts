import { z } from "zod";

/** XP-style user pictures, cropped from the diary's own photographs. */
export const AVATARS = [
  { id: "pines", name: "Pines", url: "/photos/pic-229.jpg" },
  { id: "ribbon", name: "Ribbon", url: "/photos/pic-1014.jpg" },
  { id: "red-coat", name: "Red coat", url: "/photos/pic-726.jpg" },
  { id: "boathouse", name: "Boathouse", url: "/photos/pic-594.jpg" },
  { id: "sparkler", name: "Sparkler", url: "/photos/pic-660.jpg" },
  { id: "leaves", name: "Red leaves", url: "/photos/pic-923.jpg" },
] as const;
export type AvatarId = (typeof AVATARS)[number]["id"];
export const avatarUrl = (id: string | null | undefined) => (AVATARS.find((a) => a.id === id) ?? AVATARS[0]).url;

/** Names are how readers know each other, so they are short, plain and unique (case-insensitive). */
export const displayName = z
  .string()
  .trim()
  .min(2, "at least 2 characters")
  .max(24, "24 characters at most")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, "letters, numbers, spaces, dots, dashes and underscores");

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("that doesn't look like an email address"))
  .pipe(z.string().max(254));
export const password = z.string().min(8, "at least 8 characters").max(128, "128 characters at most");

export const registerInput = z.object({
  displayName,
  email,
  password,
  turnstileToken: z.string().max(2048).optional(),
});
export const signInInput = z.object({ email, password: z.string().min(1).max(128) });
export const profileInput = z.object({
  displayName: displayName.optional(),
  avatar: z.enum(AVATARS.map((a) => a.id) as [AvatarId, ...AvatarId[]]).optional(),
});
export const inkState = z.object({
  hunger: z.number().min(0).max(100),
  joy: z.number().min(0).max(100),
  at: z.number().int().nonnegative(),
});
export type InkState = z.infer<typeof inkState>;

/** The person signed in, as the web app sees them. */
export type Me = {
  id: number;
  displayName: string;
  email: string | null;
  avatar: AvatarId;
  hasPassword: boolean;
  google: boolean;
  ink: InkState | null;
  createdAt: string;
};

/** A reader's own note, for "my notes". */
export type MyNote = { id: number; body: string; createdAt: string; slug: string; title: string; status: string };

/** Lowercased form used for uniqueness, so "Wren" and "wren" are the same name. */
export const nameKey = (name: string) => name.trim().toLowerCase().normalize("NFC");
