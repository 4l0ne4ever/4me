"use client";

import {
  type Author,
  avatarUrl,
  type CatStats,
  type Entry,
  isAwakeHour,
  type Me,
  type NowPlaying,
  type Profile,
  type Subscription,
} from "@4me/shared";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { signOut } from "@/app/welcome/actions";
import { API_URL, clockTime } from "@/lib/api";
import { useLiveConnection, useLiveEvent } from "@/lib/live";
import { liveTicket } from "@/lib/live-actions";
import { mySubscriptions, setSubscribed } from "@/lib/member-actions";
import { DEFAULT_PREF, PREF_KEY, parsePref, resolveBackground, type WallpaperPref } from "@/lib/wallpaper";
import { deleteUpload, loadUpload, saveUpload } from "@/lib/wallpaper-store";
import { AddressBar } from "./AddressBar";
import { ConfirmHost, Dialog } from "./Dialog";
import {
  IconArchive,
  IconBin,
  IconDiary,
  IconDisplay,
  IconGuestbook,
  IconHeart,
  IconMessenger,
  IconMixtape,
  IconPhotos,
  IconRss,
  IconSearch,
  IconTonight,
  IconWrite,
} from "./Icons";
import { feedInkAt, Ink, nudgeInk } from "./ink/Ink";
import { Notifications } from "./Notifications";
import { Skyline } from "./Skyline";
import { type Pos, Window } from "./Window";
import { Account } from "./windows/Account";
import { DisplayProperties, paintStyle } from "./windows/DisplayProperties";
import { Search } from "./windows/Search";
import { Write } from "./windows/Write";

// The reader's own computer. It lives in the layout, so it is never rebuilt when they go from one diary to another:
// the wallpaper, Ink, the taskbar, open windows and the live connection all stay put; only the windows that show a
// page (DeskPage) change.

export type WinId =
  | "tonight"
  | "diary"
  | "msn"
  | "guest"
  | "amp"
  | "photos"
  | "almost"
  | "archive"
  | "write"
  | "search"
  | "display"
  | "account";
type WinState = { open: boolean; min: boolean; z: number; pos?: Pos };

export const WINDOWS: Record<
  WinId,
  { title: string; task: string; icon: (c?: string) => ReactNode; className: string }
> = {
  tonight: {
    title: "Tonight — everyone's nights",
    task: "Tonight",
    icon: (c) => <IconTonight className={c} />,
    className: "w-tonight",
  },
  diary: { title: "diary.doc", task: "Diary", icon: (c) => <IconDiary className={c} />, className: "w-diary" },
  msn: {
    title: "Messenger — notes on this page",
    task: "Messenger",
    icon: (c) => <IconMessenger className={c} />,
    className: "w-msn",
  },
  guest: {
    title: "Guestbook — shoutbox",
    task: "Guestbook",
    icon: (c) => <IconGuestbook className={c} />,
    className: "w-guest",
  },
  amp: {
    title: "mixtape.m3u — every night's song",
    task: "mixtape.m3u",
    icon: (c) => <IconMixtape className={c} />,
    className: "w-amp",
  },
  photos: {
    title: "My Pictures",
    task: "Pictures",
    icon: (c) => <IconPhotos className={c} />,
    className: "w-photos",
  },
  almost: {
    title: "Almost posted",
    task: "Almost posted",
    icon: (c) => <IconBin className={c} />,
    className: "w-almost",
  },
  archive: {
    title: "Archive — everyone's nights",
    task: "Archive",
    icon: (c) => <IconArchive className={c} />,
    className: "w-archive",
  },
  write: {
    title: "Notepad — write tonight's page",
    task: "Notepad",
    icon: (c) => <IconWrite className={c} />,
    className: "w-write",
  },
  search: {
    title: "Search — people and pages",
    task: "Search",
    icon: (c) => <IconSearch className={c} />,
    className: "w-search",
  },
  display: {
    title: "Display Properties",
    task: "Display",
    icon: (c) => <IconDisplay className={c} />,
    className: "w-display",
  },
  account: {
    title: "My account",
    task: "My account",
    icon: (c) => <IconMessenger className={c} />,
    className: "w-account",
  },
};

/** The desktop's icons: one per window, always the same, so they are easy to learn. */
const ICONS: Array<[WinId, string]> = [
  ["tonight", "Tonight"],
  ["diary", "Diary"],
  ["msn", "Messenger"],
  ["guest", "Guestbook"],
  ["amp", "Mixtape"],
  ["photos", "Photos"],
  ["almost", "Almost posted"],
  ["archive", "Archive"],
  ["write", "Notepad"],
  ["search", "Search"],
];

export const SKINS = [
  { id: "midnight", name: "Midnight", swatch: "#22304a", wall: "/photos/pic-229.jpg" },
  { id: "bluehour", name: "Blue hour", swatch: "#1f3a63", wall: "/photos/pic-594.jpg" },
  { id: "candle", name: "Candle", swatch: "#8e4a22", wall: "/photos/pic-660.jpg" },
  { id: "snow", name: "Snow", swatch: "#e9ecf0", wall: "/photos/pic-726.jpg" },
  { id: "luna", name: "Luna ’06", swatch: "#1d5ad6", wall: "/photos/pic-878.jpg" },
] as const;
type SkinId = (typeof SKINS)[number]["id"];
const DAY_WALL = "/photos/pic-877.jpg";

/** What the page on screen is about, told to the computer by DeskPage. */
export type Current = { entry: Entry | null; owner: Profile | null; persona: Author | null };

type Desk = {
  me: Me | null;
  setMe: (me: Me) => void;
  wins: Record<WinId, WinState>;
  focus: WinId;
  open: (id: WinId) => void;
  raise: (id: WinId) => void;
  patch: (id: WinId, p: Partial<WinState>) => void;
  write: (id: number | null) => void;
  awake: boolean;
  /** What the person this page is about is playing on Last.fm. */
  listening: NowPlaying | null;
  /** Shakes the screen. `mine` marks a BUZZ this reader sent, so its live echo doesn't shake it twice. */
  buzz: (mine?: boolean) => void;
  setCurrent: (c: Current) => void;
  /** Goes to a page without reloading anything, with an hourglass while it loads. */
  navigate: (href: string) => void;
  pending: boolean;
  /** True after the first page: later pages' windows appear without the opening animation. */
  settled: boolean;
  /** The diaries this member subscribed to (null until known, or for guests). */
  subscriptions: Subscription[] | null;
  subscribe: (author: { handle: string; name: string; avatar: string }, on: boolean) => Promise<void>;
  /** Opens Search with these words. */
  searchFor: (q: string) => void;
};

const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("useDesk outside DeskShell");
  return desk;
}

function useLocal<T extends string>(key: string, fallback: T, valid: readonly string[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v && valid.includes(v)) setValue(v as T);
    } catch {
      // storage off; keep the default
    }
  }, [key, valid]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        // not remembered, still applied
      }
    },
    [key],
  );
  return [value, set];
}

/** A window that shows only while open and not minimised, wired to the computer's window manager. */
export function DeskWindow({ id, title, children }: { id: WinId; title?: string; children: ReactNode }) {
  const { wins, focus, raise, patch } = useDesk();
  const w = wins[id];
  if (!w.open || w.min) return null;
  return (
    <Window
      id={`win-${id}`}
      title={title ?? WINDOWS[id].title}
      icon={WINDOWS[id].icon()}
      className={WINDOWS[id].className}
      focused={focus === id}
      z={w.z}
      pos={w.pos}
      onFocus={() => focus !== id && raise(id)}
      onMinimise={() => patch(id, { min: true })}
      onClose={() => patch(id, { open: false, min: false })}
      onMove={(pos) => patch(id, { pos })}
    >
      {children}
    </Window>
  );
}

export function DeskShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [wins, setWins] = useState<Record<WinId, WinState>>(() => ({
    // The front page opens on everyone's newest pages; a diary opens on its page.
    // The front page is everyone's: tonight's pages, the shared guestbook and tonight's songs. A diary opens on its
    // page and its Messenger.
    tonight: { open: path === "/", min: false, z: 14 },
    diary: { open: path !== "/", min: false, z: 13 },
    msn: { open: path !== "/", min: false, z: 12 },
    amp: { open: true, min: false, z: 11 },
    write: { open: false, min: false, z: 10 },
    search: { open: false, min: false, z: 10 },
    archive: { open: false, min: false, z: 10 },
    guest: { open: path === "/", min: false, z: 10 },
    photos: { open: false, min: false, z: 10 },
    almost: { open: false, min: false, z: 10 },
    display: { open: false, min: false, z: 10 },
    account: { open: false, min: false, z: 10 },
  }));
  const [focus, setFocus] = useState<WinId>(path === "/" ? "tonight" : "diary");
  const zTop = useRef(20);
  const [startOpen, setStartOpen] = useState(false);
  const [rssOpen, setRssOpen] = useState(false);
  const [skin, setSkin] = useLocal<SkinId>(
    "4me-skin",
    "midnight",
    SKINS.map((s) => s.id),
  );
  const [preview, setPreview] = useState<boolean | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [clock, setClock] = useState("");
  const [shaking, setShaking] = useState(false);
  const [cat, setCat] = useState<CatStats>({ pets: 0, fish: 0, plays: 0 });
  const [listening, setListening] = useState<NowPlaying | null>(null);
  const [wallPref, setWallPref] = useState<WallpaperPref>(DEFAULT_PREF);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  /** The desktop's right-click menu: where it opens, and the point that was clicked (a fish drops there). */
  const [deskMenu, setDeskMenu] = useState<{ x: number; y: number; at: { x: number; y: number } } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [current, setCurrent] = useState<Current>({ entry: null, owner: null, persona: null });
  const [settled, setSettled] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const startBtn = useRef<HTMLButtonElement>(null);
  const startMenu = useRef<HTMLDivElement>(null);
  const ownBuzz = useRef(0);

  const awake = preview ?? (hour === null ? true : isAwakeHour(hour));
  const skinWall = SKINS.find((s) => s.id === skin)?.wall ?? SKINS[0].wall;
  const background = resolveBackground(wallPref, {
    skinWall,
    dayWall: skin === "snow" ? skinWall : DAY_WALL,
    awake,
    uploadUrl,
  });
  const paintClass =
    background.kind === "color" ? "color" : `${background.fit}${wallPref.wallpaper.source === "skin" ? "" : " mine"}`;
  const personaHandle = current.persona?.handle;

  /* the computer starts: clock, film grain, who is signed in, Ink's world stats, the reader's wallpaper */
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setHour(d.getHours());
      setClock(clockTime(d));
    };
    tick();
    const t = window.setInterval(tick, 15_000);
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 140;
      const g = c.getContext("2d");
      if (g) {
        const img = g.createImageData(140, 140);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        document.documentElement.style.setProperty("--grain", `url(${c.toDataURL()})`);
      }
    } catch {
      // no grain, still fine
    }
    // Asked after the page renders, so every page can be cached for everyone.
    fetch("/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: Me | null) => setMe(v))
      .catch(() => undefined);
    fetch(`${API_URL}/cat`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: CatStats | null) => v && setCat(v))
      .catch(() => undefined);
    let url: string | null = null;
    try {
      setWallPref(parsePref(localStorage.getItem(PREF_KEY)));
    } catch {
      // storage off; the skin's wallpaper it is
    }
    void loadUpload().then((blob) => {
      if (!blob) return;
      url = URL.createObjectURL(blob);
      setUploadUrl(url);
    });
    const settle = window.setTimeout(() => setSettled(true), 1200);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(settle);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  /* what the person this diary belongs to is listening to (nobody's on the front page) */
  useEffect(() => {
    setListening(null);
    if (!personaHandle) return;
    const load = () =>
      fetch(`${API_URL}/now-playing?user=${encodeURIComponent(personaHandle)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v: NowPlaying | null) => setListening(v))
        .catch(() => undefined);
    void load();
    const l = window.setInterval(load, 60_000);
    return () => window.clearInterval(l);
  }, [personaHandle]);

  useEffect(() => {
    document.body.dataset.skin = skin;
    document.body.classList.toggle("daytime", !awake);
  }, [skin, awake]);

  useEffect(() => {
    document.body.classList.toggle("busy", pending);
  }, [pending]);

  const applyWallpaper = useCallback((pref: WallpaperPref) => {
    setWallPref(pref);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(pref));
    } catch {
      // applied for this visit only
    }
  }, []);

  const storeUpload = useCallback(async (picture: Blob) => {
    await saveUpload(picture);
    setUploadUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(picture);
    });
  }, []);

  const removeUpload = useCallback(async () => {
    await deleteUpload();
    setUploadUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setWallPref((p) => {
      if (p.wallpaper.source !== "upload") return p;
      const next = { ...p, wallpaper: { source: "skin" as const } };
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(next));
      } catch {
        // fine
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!deskMenu) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".deskmenu"))
        setDeskMenu(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [deskMenu]);

  const onDeskContext = (e: ReactMouseEvent<HTMLDivElement>) => {
    // The street across the way is part of the desktop too (a fish can land on a roof).
    if ((e.target as Element).closest(".win, .icon, button:not(.sk-hit), a, input, textarea, select")) return;
    e.preventDefault();
    setDeskMenu({
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 180),
      at: { x: e.clientX, y: e.clientY },
    });
  };

  useEffect(() => {
    if (!startOpen) return;
    startMenu.current?.querySelector<HTMLElement>("button, a")?.focus();
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          setStartOpen(false);
          startBtn.current?.focus();
        }
        return;
      }
      const t = e.target as Node;
      if (!startMenu.current?.contains(t) && !startBtn.current?.contains(t)) setStartOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [startOpen]);

  /* window manager */
  const raise = useCallback((id: WinId) => {
    zTop.current += 1;
    const z = zTop.current;
    setWins((w) => ({ ...w, [id]: { ...w[id], z } }));
    setFocus(id);
  }, []);
  const open = useCallback((id: WinId) => {
    zTop.current += 1;
    const z = zTop.current;
    setWins((w) => ({ ...w, [id]: { ...w[id], open: true, min: false, z } }));
    setFocus(id);
    setStartOpen(false);
    if (window.innerWidth < 900) {
      window.setTimeout(
        () => document.getElementById(`win-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    }
  }, []);
  const patch = useCallback(
    (id: WinId, p: Partial<WinState>) => setWins((w) => ({ ...w, [id]: { ...w[id], ...p } })),
    [],
  );
  const taskClick = (id: WinId) => {
    const w = wins[id];
    if (w.min) open(id);
    else if (focus === id) patch(id, { min: true });
    else raise(id);
  };

  const write = useCallback(
    (id: number | null) => {
      setEditing(id);
      open("write");
    },
    [open],
  );

  useEffect(() => {
    if (me) void mySubscriptions().then(setSubscriptions);
    else setSubscriptions(null);
  }, [me]);

  const subscribe = useCallback(async (author: { handle: string; name: string; avatar: string }, on: boolean) => {
    setSubscriptions((list) =>
      on
        ? [...(list ?? []).filter((s) => s.handle !== author.handle), { ...author, lastWroteAt: null }]
        : (list ?? []).filter((s) => s.handle !== author.handle),
    );
    const res = await setSubscribed(author.handle, on);
    if (!res.ok) void mySubscriptions().then(setSubscriptions);
  }, []);

  const searchFor = useCallback(
    (q: string) => {
      setQuery(q);
      open("search");
    },
    [open],
  );

  const navigate = useCallback(
    (href: string) => {
      setStartOpen(false);
      startTransition(() => router.push(href));
    },
    [router],
  );

  const buzz = useCallback((mine = false) => {
    if (mine) ownBuzz.current = Date.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShaking(false);
    window.requestAnimationFrame(() => setShaking(true));
    window.setTimeout(() => setShaking(false), 650);
  }, []);

  /* live: the page on screen, the guestbook on screen, new pages, and (signed in) my notifications */
  const entryId = current.entry?.id;
  const ownerHandle = current.owner?.handle;
  const topics = useMemo(
    // The front desktop's Messenger follows the notes on every page.
    () =>
      [entryId ? `entry:${entryId}` : "", `guest:${ownerHandle ?? "_"}`, "tonight", ownerHandle ? "" : "notes"].filter(
        Boolean,
      ),
    [entryId, ownerHandle],
  );
  const liveState = useLiveConnection(topics, me ? liveTicket : null);
  useLiveEvent((e) => {
    // A BUZZ from someone else reading the same page shakes this screen too (mine already did).
    if (e.type === "buzz" && e.entryId === entryId && Date.now() - ownBuzz.current > 2500) buzz();
  });

  const desk: Desk = {
    me,
    setMe,
    wins,
    focus,
    open,
    raise,
    patch,
    write,
    awake,
    listening,
    buzz,
    setCurrent,
    navigate,
    pending,
    settled,
    subscriptions,
    subscribe,
    searchFor,
  };

  const visible = (Object.keys(WINDOWS) as WinId[]).filter((id) => wins[id].open);
  const { owner } = current;
  const login = `/welcome?next=${encodeURIComponent(path)}`;

  return (
    <DeskContext.Provider value={desk}>
      <ConfirmHost>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click on empty desktop; the same actions are in the Start menu */}
        <div
          className={`desk${shaking ? " shake" : ""}${settled ? " settled" : ""}${pending ? " busy" : ""}`}
          onContextMenu={onDeskContext}
        >
          <div className="wall" aria-hidden="true">
            <div className={`paint ${paintClass}`} style={paintStyle(background)} />
          </div>
          <Skyline />
          <nav className="icons" aria-label="Desktop">
            {ICONS.map(([id, label]) => (
              <button key={id} type="button" className="icon" onClick={() => (id === "write" ? write(null) : open(id))}>
                {WINDOWS[id].icon()}
                {label}
              </button>
            ))}
          </nav>

          {children}

          <DeskWindow id="write" title={editing ? "Notepad — editing a page" : undefined}>
            {me ? (
              <Write
                me={me}
                editing={editing}
                onEditing={setEditing}
                onSaved={(e) => {
                  patch("write", { open: false, min: false });
                  navigate(`/u/${e.author.handle}/${e.slug}`);
                }}
                onDeleted={() => navigate(`/u/${me.handle}`)}
              />
            ) : (
              <div className="body acc">
                <p>
                  Everyone here keeps a night diary. <a href={login}>Log on or create an account</a> to write yours.
                </p>
              </div>
            )}
          </DeskWindow>
          <DeskWindow id="search">
            <Search query={query} onQuery={setQuery} />
          </DeskWindow>
          <DeskWindow id="display">
            <DisplayProperties
              pref={wallPref}
              skinWall={skinWall}
              uploadUrl={uploadUrl}
              onApply={applyWallpaper}
              onClose={() => patch("display", { open: false, min: false })}
              onUpload={storeUpload}
              onRemoveUpload={removeUpload}
            />
          </DeskWindow>
          <DeskWindow id="account">
            {me ? (
              <Account me={me} onMe={setMe} />
            ) : (
              <div className="body acc">
                <p>
                  You&apos;re not logged on. <a href={login}>Log on or create an account</a>.
                </p>
              </div>
            )}
          </DeskWindow>
        </div>

        {startOpen && (
          <div className="startmenu" ref={startMenu} id="startmenu" role="menu" aria-label="Start">
            <div className="sm-head">
              <img src={me ? avatarUrl(me.avatar) : "/photos/pic-229.jpg"} alt="" width={44} height={44} />
              <div>
                <b>{me ? me.displayName : "Guest"}</b>
                <span>{me ? `4me://${me.handle}` : "log on to keep a diary"}</span>
              </div>
            </div>
            <ul className="sm-list">
              {me ? (
                <li>
                  <button type="button" role="menuitem" onClick={() => navigate(`/u/${me.handle}`)}>
                    <img className="sm-av" src={avatarUrl(me.avatar)} alt="" width={24} height={24} />
                    My diary
                  </button>
                </li>
              ) : (
                <li>
                  <a href="/welcome?start=register" role="menuitem">
                    <IconWrite />
                    Start a diary
                  </a>
                </li>
              )}
              <li>
                <button type="button" role="menuitem" onClick={() => navigate("/")}>
                  {WINDOWS.tonight.icon()}
                  Home: tonight&apos;s pages
                </button>
              </li>
              <li>
                <button type="button" role="menuitem" onClick={() => write(null)}>
                  {WINDOWS.write.icon()}
                  Write tonight&apos;s page
                </button>
              </li>
              <li>
                <button type="button" role="menuitem" onClick={() => open("search")}>
                  {WINDOWS.search.icon()}
                  Search…
                </button>
              </li>
              <li className="sm-sep" aria-hidden="true" />
              {(["feed", "play", "call"] as const).map((a) => (
                <li key={a}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setStartOpen(false);
                      nudgeInk(a);
                    }}
                  >
                    <IconHeart />
                    {a === "feed" ? "Give Ink a fish" : a === "play" ? "Play with Ink" : "Call Ink over"}
                  </button>
                </li>
              ))}
              <li className="sm-sep" aria-hidden="true" />
              <li>
                <button type="button" role="menuitem" onClick={() => open("display")}>
                  <IconDisplay />
                  Change background…
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setStartOpen(false);
                    setRssOpen(true);
                  }}
                >
                  <IconRss />
                  Follow in a feed reader…
                </button>
              </li>
              <li className="sm-sep" aria-hidden="true" />
              {me ? (
                <>
                  <li>
                    <button type="button" role="menuitem" onClick={() => open("account")}>
                      <img className="sm-av" src={avatarUrl(me.avatar)} alt="" width={24} height={24} />
                      My account…
                    </button>
                  </li>
                  <li>
                    <form action={signOut}>
                      <button type="submit" role="menuitem">
                        <span className="sm-power" aria-hidden="true" />
                        Log off {me.displayName}
                      </button>
                    </form>
                  </li>
                </>
              ) : (
                <li>
                  <a href={login} role="menuitem">
                    <span className="sm-power" aria-hidden="true" />
                    Log on…
                  </a>
                </li>
              )}
            </ul>

            <fieldset className="skins">
              <legend className="sm-label">Skin</legend>
              {SKINS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="skin"
                  aria-pressed={skin === s.id}
                  onClick={() => setSkin(s.id)}
                >
                  <i style={{ background: s.swatch }} />
                  {s.name}
                </button>
              ))}
            </fieldset>
          </div>
        )}

        {deskMenu && (
          <div className="deskmenu" role="menu" aria-label="Desktop" style={{ left: deskMenu.x, top: deskMenu.y }}>
            <button
              type="button"
              role="menuitem"
              // biome-ignore lint/a11y/noAutofocus: a context menu takes focus when it opens
              autoFocus
              onClick={() => {
                setDeskMenu(null);
                open("display");
              }}
            >
              Change background…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDeskMenu(null);
                startTransition(() => router.refresh());
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDeskMenu(null);
                feedInkAt(deskMenu.at.x, deskMenu.at.y);
              }}
            >
              Drop a fish here
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDeskMenu(null);
                nudgeInk("call");
              }}
            >
              Call Ink over
            </button>
          </div>
        )}

        <Ink awake={awake} stats={cat} onStats={setCat} me={me} />

        <footer className="task">
          <button
            ref={startBtn}
            type="button"
            className="start"
            aria-haspopup="menu"
            aria-expanded={startOpen}
            aria-controls="startmenu"
            onClick={() => setStartOpen((o) => !o)}
          >
            4me
          </button>
          <AddressBar path={path} me={me} />
          <div className="tasks">
            {visible.map((id) => (
              <button
                key={id}
                type="button"
                className="tbtn"
                aria-pressed={focus === id && !wins[id].min}
                onClick={() => taskClick(id)}
              >
                {WINDOWS[id].task}
              </button>
            ))}
          </div>
          <div className="tray">
            {me && <Notifications me={me} />}
            <span
              className={`net net-${liveState}`}
              title={liveState === "live" ? "Live: new notes appear by themselves" : "Reconnecting…"}
              role="img"
              aria-label={liveState === "live" ? "Live updates on" : "Reconnecting"}
            />
            <span className="hearts" title="Times readers have petted Ink">
              <IconHeart />
              {cat.pets.toLocaleString("en")}
            </span>
            <span className="state-dot" aria-hidden="true" />
            <span>{awake ? "awake" : "asleep"}</span>
            <button
              type="button"
              className="preview"
              aria-pressed={preview !== null}
              onClick={() => setPreview(!awake)}
            >
              {awake ? "Preview daytime" : "Preview night"}
            </button>
            <span className="clock">{clock}</span>
          </div>
        </footer>
        {rssOpen && <RssDialog owner={owner} onClose={() => setRssOpen(false)} />}
      </ConfirmHost>
    </DeskContext.Provider>
  );
}

/**
 * What "RSS" means, in a message box: the feed's address to paste into a reader app, instead of the raw XML the
 * browser would otherwise show.
 */
function RssDialog({ owner, onClose }: { owner: Profile | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const path = owner ? `/u/${owner.handle}/rss.xml` : "/rss.xml";
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${path}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      title={owner ? `Follow ${owner.name}'s diary` : "Follow 4me"}
      onClose={onClose}
      buttons={
        <>
          <button type="button" className="btn" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p>
        {owner ? `Every new page ${owner.name} writes` : "Every new page on 4me"} can come to you in a feed reader
        (Feedly, Inoreader, NetNewsWire, Reeder…), with no account here and nothing to check.
      </p>
      <p>Paste this address into the reader&apos;s &ldquo;add feed&rdquo; box:</p>
      <input
        className="field mb-copy"
        readOnly
        value={url}
        aria-label="Feed address"
        onFocus={(e) => e.currentTarget.select()}
      />
    </Dialog>
  );
}
