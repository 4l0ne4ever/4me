import type { MoodTone, NightSky } from "@4me/shared";

/** Each family of moods as a colour for the sky, and the word for it. */
export const TONES: Record<MoodTone, { color: string; word: string }> = {
  tired: { color: "#3a3f92", word: "tired" },
  blue: { color: "#3b6aa3", word: "blue" },
  calm: { color: "#2c7f7b", word: "calm" },
  warm: { color: "#c47a36", word: "warm" },
  restless: { color: "#7b45a3", word: "restless" },
  drifting: { color: "#5a5896", word: "drifting" },
};

/** The sky's two strongest colours, or null on a night with no moods yet. */
export function skyColours(sky: NightSky | null): [string, string] | null {
  const [a, b] = sky?.tones ?? [];
  if (!a) return null;
  return [TONES[a.tone].color, TONES[(b ?? a).tone].color];
}

/** "Tonight the sky is mostly tired (4 of 7 pages)", or null with nothing to say. */
export function skyLine(sky: NightSky | null): string | null {
  const top = sky?.tones[0];
  if (!sky || !top) return null;
  const counted = sky.tones.reduce((n, t) => n + t.count, 0);
  if (counted === 1) return `One page so far tonight, and it feels ${TONES[top.tone].word}.`;
  return top.count / counted >= 0.5
    ? `Tonight the sky is mostly ${TONES[top.tone].word}: ${top.count} of ${counted} pages.`
    : `Tonight the sky is mixed, a little ${TONES[top.tone].word} more than anything.`;
}
