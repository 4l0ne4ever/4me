"use server";

import { headers } from "next/headers";
import { internalApi } from "./auth";

/** A reader's browser hit an error while showing a page: what it says, and on which page. Nothing about them. */
export async function reportBrowserError(message: string, path: string, digest?: string): Promise<void> {
  if (typeof message !== "string" || typeof path !== "string") return;
  // Only from our own pages.
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const origin = (await headers()).get("origin");
  if (site && origin && origin !== site) return;
  try {
    await internalApi("/errors", {
      method: "POST",
      body: {
        source: "browser",
        message: `${message.slice(0, 400)}${typeof digest === "string" && digest ? ` (digest ${digest.slice(0, 40)})` : ""}`,
        path: path.split("?")[0]!.slice(0, 200),
      },
    });
  } catch {
    // nothing more to do
  }
}
