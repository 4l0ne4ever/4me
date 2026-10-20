"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (t: string) => void; theme?: string; size?: string },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/**
 * Cloudflare Turnstile, only when a site key is configured. Returns the widget, the current token
 * and a reset for after each submit. Without a key it renders nothing and the token stays undefined.
 */
export function useTurnstile() {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    const mount = () => {
      if (!window.turnstile || !box.current || widget.current) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        callback: setToken,
        theme: "dark",
        size: "flexible",
      });
    };
    if (window.turnstile) mount();
    else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      const s = existing ?? document.createElement("script");
      if (!existing) {
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.dataset.turnstile = "1";
        document.head.appendChild(s);
      }
      s.addEventListener("load", mount);
    }
  }, []);

  const reset = () => {
    setToken(undefined);
    if (widget.current) window.turnstile?.reset(widget.current);
  };

  return { needed: Boolean(SITE_KEY), token, reset, widget: SITE_KEY ? <div ref={box} /> : null };
}
