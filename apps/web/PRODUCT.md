# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Members of 4me, a multi-author night-diary blog at 2die429.com, and the guests who read them. Members write a page each night, leave notes, message each other, and now sit down together at a Werewolf table on the same desktop. Players are friends gathered by an invite link or the desktop's list of open tables; they play on laptops and phones equally, usually with voice on.

## Product Purpose

4me is a blog, not a social network: a quiet place to keep a night diary, read other people's nights, and leave a word. Its extras (Ink the cat, the shared poem, night sounds, special nights, the Werewolf table) exist to make the night feel shared without turning the site into a feed. Success for the Werewolf table: a group of friends can open a table, choose how many players and which roles, and play a whole game with low-latency voice, the computer acting as narrator, on any device.

## Positioning

The whole site is one 2006-era night desktop: windows, a taskbar, a Start menu, desktop icons, a wallpaper that follows the hour. Every feature lives as a window on that desktop, in the same window chrome, so the Werewolf game is a window there too, not a separate app.

## Operating Context

- A night runs 06:00 to 05:59 Vietnam time. The site leans into the night: blue hour, rain, crickets, the moon.
- Werewolf: members only (guests can see open tables but must sign in to sit down). Tables are joined by a six-character code or link, or from the open-tables list. The computer narrates; phases are timed; voice is peer-to-peer WebRTC, and who can hear whom follows the game (wolves alone at night, the dead among themselves).
- Players use laptops and phones equally; both must carry the full game: voice, choosing targets, voting, chat.

## Capabilities and Constraints

- Web app: Next.js on Vercel; API on Cloudflare Workers (free plan, Durable Objects per table).
- Secrets stay server-side.
- All interface copy is English, Werewolf included (Werewolf, Seer, Witch, Bodyguard...).
- Roles available: Villager, Werewolf, Wolf cub, Seer, Bodyguard, Witch, Hunter, Cupid, Elder, Village idiot, Cursed, Tanner; 5 to 16 players; the host sets roles (or leaves them automatic), timers, a sheriff election, whether roles show on death, and whether the table is listed.

## Brand Commitments

- Name: 4me. Mascot: Ink, a pixel cat.
- The 2006 night desktop is binding: window chrome, taskbar, desktop icons, the hand-made, slightly nostalgic voice.
- Copy is plain, short, a little wry; no exclamation-mark hype.

## Product Principles

- A blog first: a feature earns its place by making the night feel shared, not by adding feeds or counters.
- Everything is a window on the desktop.
- In the game, say little: show the night, the table and the one thing to do now; rules and logs stay one click away.
- Night must feel like night and day like day, and both must stay readable.
- Never look like a modern mobile game: no glossy gradients, neon or slot-machine cards.

## Accessibility & Inclusion

Text must stay legible at night (contrast on dark grounds); the desktop has a "large text" setting that windows honor; every control works by keyboard and on touch.
