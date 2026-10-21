// The taskbar's address bar speaks "4me://<handle>/<page>"; these turn it into site paths and back.

/** "/u/lan/the-last-tram" -> "4me://lan/the-last-tram"; the front page is "4me://tonight". */
export function toAddress(path: string): string {
  const m = path.match(/^\/u\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (m) return `4me://${m[1]}${m[2] ? `/${m[2]}` : ""}`;
  return path === "/" || path === "" ? "4me://tonight" : `4me:/${path}`;
}

/** What was typed, as a path on the site, or null when it can't be one: "lan", "4me://lan/x", "/u/lan" all work. */
export function fromAddress(typed: string): string | null {
  const rest = typed
    .trim()
    .toLowerCase()
    .replace(/^4me:\/\//, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^u\//, "");
  if (rest === "" || rest === "tonight" || rest === "home") return "/";
  const m = rest.match(/^([a-z0-9][a-z0-9_]{1,19})(?:\/([a-z0-9-]{1,80}))?$/);
  return m ? `/u/${m[1]}${m[2] ? `/${m[2]}` : ""}` : null;
}
