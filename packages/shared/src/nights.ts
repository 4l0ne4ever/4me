// What 4me calls a night, and the things that come with each one: its question, and the sky its moods make.

/** Vietnam keeps one offset all year (UTC+7, no summer time). */
const VN_OFFSET = 7 * 3600_000;

/**
 * The night a moment belongs to, named by its evening's date in Vietnam: from 06:00 one day until 05:59 the next
 * is that day's night, so a page written at 02:00 still belongs to the evening before.
 */
export function nightOf(at: Date): string {
  const local = new Date(at.getTime() + VN_OFFSET);
  if (local.getUTCHours() < 6) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

/** The night before, or after, by days. */
export function nightShift(night: string, days: number): string {
  const d = new Date(`${night}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One question a night, to start a page with when the page is blank. */
export const PROMPTS = [
  "What didn't you say today?",
  "Which light was still on when you came home?",
  "What song would play if tonight had a soundtrack?",
  "Who did you think of on the way home?",
  "What did the air smell like tonight?",
  "What are you keeping for tomorrow?",
  "Which small thing went right today?",
  "What would you tell yourself from a year ago?",
  "Where were you at exactly nine o'clock?",
  "What is the last thing you saw before the screen?",
  "Which message are you not answering?",
  "What did you eat alone today, and where?",
  "Describe the room you are in without naming it.",
  "What sound is outside your window right now?",
  "What do you miss that you never had?",
  "Who made you laugh today?",
  "What would you do with one more hour tonight?",
  "Which street did you walk down today?",
  "What is the weather inside you?",
  "What did you almost buy?",
  "Which memory came back for no reason today?",
  "What did you see on the bus, or on the bike, that no one else noticed?",
  "Write a letter you won't send.",
  "What are you pretending not to know?",
  "What did your hands do all day?",
  "Which word did you hear too many times today?",
  "What would the city say about you tonight?",
  "When did you last feel completely at home?",
  "What is unfinished on your desk?",
  "What would you like to be asked?",
  "What colour was today?",
  "Who is awake right now that you wish you could call?",
  "What did you learn by accident today?",
  "What is the kindest thing someone did, even if not for you?",
  "Describe a door you walked through today.",
  "What are you looking forward to, however small?",
  "What did the rain, or the heat, change today?",
  "Which photo on your phone tells the truth about this week?",
  "What would a stranger guess about your day?",
  "What did you forgive, or not, today?",
  "What is the oldest thing you own, and why do you keep it?",
  "Which plan quietly changed today?",
  "Who taught you something without meaning to?",
  "What is the last thing that made you stop walking?",
  "What would you write on the wall of your room?",
  "Which part of today would you play again?",
  "What did you say yes to that you meant no?",
  "If tonight were a place, where would it be?",
  "What do you hope nobody reads here?",
  "What is waiting for you in the morning?",
] as const;

/** Tonight's question: the same for everyone for the whole night, a different one the next. */
export function promptFor(night: string): string {
  const day = Math.floor(Date.parse(`${night}T00:00:00Z`) / 86_400_000);
  // Stepping by a number with no factor in common with the list's length visits every question before repeating,
  // and two nights in a row are never next to each other in the list.
  return PROMPTS[(((day * 17) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length] ?? PROMPTS[0];
}

/** The families of moods the sky is coloured by. Moods are written freely, in English or Vietnamese. */
export type MoodTone = "tired" | "blue" | "calm" | "warm" | "restless" | "drifting";
const TONES: Array<[MoodTone, RegExp]> = [
  [
    "restless",
    /anxious|restless|nervous|worried|sleepless|insomnia|stress|lo lắng|bồn chồn|mất ngủ|căng thẳng|hồi hộp/i,
  ],
  ["tired", /tired|sleepy|exhausted|drained|worn|weary|mệt|buồn ngủ|kiệt|uể oải|đuối/i],
  ["blue", /sad|lonely|alone|missing|miss|empty|blue|melanchol|cry|heartbr|buồn|cô đơn|nhớ|trống|khóc|tủi/i],
  ["warm", /happy|glad|grateful|warm|content|joy|loved|excited|cheer|vui|hạnh phúc|ấm|biết ơn|hào hứng|yêu/i],
  ["drifting", /drift|dream|nostalg|numb|floating|hazy|lost|lơ lửng|hoài niệm|mơ|man mác|trôi/i],
  ["calm", /calm|fine|okay|ok\b|quiet|peace|still|rest|bình yên|ổn|yên|thư thả|nhẹ/i],
];

/** The family a written mood belongs to, or null when it can't be told. */
export function moodTone(mood: string): MoodTone | null {
  const m = mood.trim();
  if (!m) return null;
  return TONES.find(([, re]) => re.test(m))?.[0] ?? null;
}

/** Tonight's sky, from the moods of tonight's pages. */
export type NightSky = { night: string; total: number; tones: Array<{ tone: MoodTone; count: number }> };
