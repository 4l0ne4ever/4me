import { sql } from "drizzle-orm";
import { almost, blasts, catStats, entries, notes, shouts, users } from "./db/schema";
import type { DB } from "./db/types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

const sampleEntries = [
  {
    slug: "the-lamps-came-on-early",
    title: "The lamps came on before I got home",
    mood: "drifting",
    weather: "drizzle, 9°",
    hours: 3,
    song: ["How to Disappear Completely", "Radiohead"],
    photos: [
      { url: "/photos/pic-832.jpg", caption: "after, writing" },
      { url: "/photos/pic-600.jpg", caption: "the shortcut" },
    ],
    body: `I left work a little later than usual. By the time I got out, every streetlamp was on, that orange light spilling over a road still wet from the afternoon. The sky wasn't dark yet, but it wasn't light either. Blue, like someone had stirred ink into water.

I stood at the bus stop for ten minutes without remembering which line I was waiting for. ~~I thought about calling you.~~ The chorus came round just as a bus went past without stopping.

> it will probably rain again tomorrow.

Some days nothing is sad, exactly. You just can't find where you are. Today was one of those. Ink was waiting on the windowsill when I got in, which helped.`,
  },
  {
    slug: "thirteen-minutes-to-three",
    title: "Thirteen minutes to three",
    mood: "sleepless",
    weather: "clear, 4°",
    hours: 51,
    song: ["Between the Bars", "Elliott Smith"],
    photos: [{ url: "/photos/pic-878.jpg", caption: "trees with their arms up" }],
    body: `Counted the stones in the ceiling, then the years since I last slept through a whole night in October.

Ink sat on my chest at some point and purred like a small engine. ~~I almost texted.~~ I didn't.

> the radiator ticks like a clock that lost its hands.`,
  },
  {
    slug: "bus-18-and-the-fogged-up-window",
    title: "Bus 18 and the fogged-up window",
    mood: "calm",
    weather: "overcast, 11°",
    hours: 99,
    song: ["Transatlanticism", "Death Cab for Cutie"],
    photos: [{ url: "/photos/pic-338.jpg", caption: "the shore, last week" }],
    body: `I drew a door on the glass and nobody got off. The whole bus smelled of wet umbrellas.

Somebody's phone played the same song I had in my ears, half a second behind. For three stops we were in a duet without knowing each other.`,
  },
  {
    slug: "snow-came-early-on-the-hill",
    title: "Snow came early on the hill",
    mood: "missing someone",
    weather: "snow, 0°",
    hours: 171,
    song: ["Fade Into You", "Mazzy Star"],
    photos: [{ url: "/photos/pic-726.jpg", caption: "the hill, the first snow" }],
    body: `Footprints going up, none coming down. Mine.

I wore the red coat because nobody can lose you in a red coat. _That was the idea, anyway._`,
  },
];

/** Fills an empty database with two writers and a few nights, so the desktops have something to show. */
export async function seedIfEmpty(db: DB) {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(entries);
  if (n > 0) return false;

  // Sample writers have no password or Google link, so nobody can sign in as them.
  const [author, lan] = await db
    .insert(users)
    .values([
      { displayName: "4me", nameKey: "4me", handle: "4me", avatar: "ribbon", bio: "one entry after dark." },
      { displayName: "Lan", nameKey: "lan", handle: "lan", avatar: "boathouse", bio: "night shifts, early trams." },
    ])
    .returning({ id: users.id });

  const inserted = await db
    .insert(entries)
    .values(
      sampleEntries.map((e) => ({
        authorId: author!.id,
        slug: e.slug,
        title: e.title,
        body: e.body,
        mood: e.mood,
        weather: e.weather,
        writtenAt: hoursAgo(e.hours),
        songTitle: e.song[0],
        songArtist: e.song[1],
        photos: e.photos,
        readCount: 40 + e.hours,
      })),
    )
    .returning({ id: entries.id, slug: entries.slug });

  await db.insert(entries).values({
    authorId: lan!.id,
    slug: "the-last-tram",
    title: "The last tram",
    mood: "tired, fine",
    weather: "mist, 7°",
    writtenAt: hoursAgo(5),
    songTitle: "Holocene",
    songArtist: "Bon Iver",
    photos: [{ url: "/photos/pic-594.jpg", caption: "the depot at one" }],
    body: `Missed the 00:40 by a breath and walked instead. The river was doing that thing where it looks like it's holding its breath too.

> nobody is awake on this street but the bakery.`,
  });

  const latest = inserted.find((r) => r.slug === "the-lamps-came-on-early")!;
  await db.insert(notes).values([
    {
      entryId: latest.id,
      name: "grey_cloud_92",
      body: "“blue, like someone had stirred ink into water.” sat at the window for a while after that",
    },
    {
      entryId: latest.id,
      name: "4me",
      userId: author!.id,
      isAuthor: true,
      body: "thank you. only after writing it did i notice the sky really was like that",
    },
    { entryId: latest.id, name: "hanh.", body: "listening to this song at a bus stop is a lost cause" },
    { entryId: latest.id, name: "a stranger", body: "it is raining tomorrow. bring an umbrella. say hi to Ink" },
  ]);

  await db.insert(shouts).values([
    {
      ownerId: author!.id,
      name: "grey_cloud_92",
      body: "read the bus 18 one on a night shift. felt like someone was sitting with me :-)",
    },
    { ownerId: author!.id, name: "hanh.", body: "first hit counter since 2007. visitor four thousand something <3" },
    { ownerId: author!.id, name: "wren", body: "your cat walked across my screen and i laughed out loud" },
    { ownerId: author!.id, name: "m.", body: "leaving the light on for whoever reads this at 3 am" },
    { ownerId: lan!.id, name: "hanh.", body: "the tram one. yes. exactly that." },
  ]);

  await db.insert(blasts).values(
    [
      { body: "away. don't buzz. (buzz.)", createdAt: hoursAgo(300) },
      { body: "found my old mp3 player. it still works.", createdAt: hoursAgo(260) },
      { body: "the snow beat me to the hill", createdAt: hoursAgo(170) },
      { body: "mưa rồi. không ai đón.", createdAt: hoursAgo(75) },
      { body: "rain again. no one's coming. that's fine.", createdAt: hoursAgo(2) },
    ].map((b) => ({ ...b, authorId: author!.id })),
  );
  await db.insert(blasts).values({ authorId: lan!.id, body: "on the night bus, again", createdAt: hoursAgo(4) });

  await db.insert(almost).values(
    [
      { body: "i miss who i was in 2006 more than i miss anyone.", deletedAt: hoursAgo(52) },
      { body: "maybe i should just move somewhere with more snow.", deletedAt: hoursAgo(170) },
      { body: "you were the only one who knew the song.", deletedAt: hoursAgo(250) },
      { body: "today i was happy for no reason and it scared me.", deletedAt: hoursAgo(380) },
      { body: "if you're reading this, hi.", deletedAt: hoursAgo(460) },
    ].map((a) => ({ ...a, authorId: author!.id })),
  );

  await db.insert(catStats).values({ id: 1, pets: 1204, fish: 318, plays: 77 }).onConflictDoNothing();
  // Sample text is plain English, so lower-casing is all search needs.
  await db.update(entries).set({ searchText: sql`lower(${entries.title} || ' ' || ${entries.body})` });
  await db.update(users).set({ searchName: sql`lower(${users.displayName} || ' ' || ${users.handle})` });
  return true;
}
