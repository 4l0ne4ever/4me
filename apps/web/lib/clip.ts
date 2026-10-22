import { useEffect, useSyncExternalStore } from "react";

// One sound at a time on the desktop. Any player about to make sound says so, and every other player stops: the
// mixtape, a page's song ticket, and the 30-second clips on song stickers and in the song search.

const EVENT = "4me-audio";

/** Says this player is about to make sound; every other one stops. */
export function claimAudio(who: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: who }));
}

/** Stops this player whenever another one starts. */
export function useOtherAudio(who: string, stop: () => void) {
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== who) stop();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [who, stop]);
}

// The clips share one <audio>, so starting one sticker stops the sticker that was playing.
let audio: HTMLAudioElement | null = null;
let current: string | null = null;
const listeners = new Set<() => void>();
const set = (url: string | null) => {
  current = url;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function stopClip() {
  audio?.pause();
  set(null);
}

if (typeof window !== "undefined") {
  window.addEventListener(EVENT, (e) => {
    if ((e as CustomEvent<string>).detail !== "clip") stopClip();
  });
}

/** Plays or stops a 30-second clip; `playing` is the clip playing now, if any. */
export function useClip() {
  const playing = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const toggle = (url: string | null) => {
    if (!url) return;
    if (current === url) return stopClip();
    audio ??= new Audio();
    audio.src = url;
    audio.onended = () => set(null);
    claimAudio("clip");
    void audio.play().then(
      () => set(url),
      () => set(null),
    );
  };
  return { playing, toggle, stop: stopClip };
}
