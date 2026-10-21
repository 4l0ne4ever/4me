"use client";

import { useRouter } from "next/navigation";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useDesk } from "./DeskShell";

/**
 * A link to another page of the diary that never reloads the computer: it loads the page in the background (the
 * cursor turns into an hourglass) and swaps the windows' contents. It starts loading as soon as it's pointed at.
 * Ctrl/Cmd-click and middle-click still open a new tab.
 */
export function DeskLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useDesk();
  const router = useRouter();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  const warm = () => router.prefetch(href);
  return <a href={href} onClick={click} onMouseEnter={warm} onFocus={warm} {...rest} />;
}
