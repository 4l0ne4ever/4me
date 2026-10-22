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
      remove?: (id: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/**
 * Cloudflare Turnstile, only when a site key is configured. Returns the widget, the current token
 * and a reset for after each submit. Without a key it renders nothing and the token stays undefined.
 */
export function useTurnstile() {
  // The box can appear later than the hook (a form that opens on a click), so the widget mounts when the box does.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!SITE_KEY || !box) return;
    let gone = false;
    const mount = () => {
      if (gone || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(box, {
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
    // The box went away (the form closed): its widget goes too, and a new box gets a new one.
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove?.(widget.current);
      widget.current = null;
      setToken(undefined);
    };
  }, [box]);

  const reset = () => {
    setToken(undefined);
    if (widget.current) window.turnstile?.reset(widget.current);
  };

  // Until the check answers, the button it guards stays off: say why, so a blocked check isn't a mystery.
  const view = SITE_KEY ? (
    <div className="ts-box">
      <div ref={setBox} />
      {!token && (
        <p className="ts-wait" role="status">
          Checking that you&apos;re a person… If this never finishes, allow challenges.cloudflare.com.
        </p>
      )}
    </div>
  ) : null;
  return { needed: Boolean(SITE_KEY), token, reset, widget: view };
}
