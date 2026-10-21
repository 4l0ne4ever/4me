"use client";

import {
  type Almost as AlmostItem,
  type Author,
  avatarUrl,
  type Blast,
  type CatStats,
  type Entry,
  type EntrySummary,
  isAwakeHour,
  type Me,
  type Note,
  type NowPlaying,
  type Profile,
  type Shout,
} from "@4me/shared";
import { usePathname, useRouter } from "next/navigation";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signOut } from "@/app/welcome/actions";
import { API_URL, apiSend, hhmm } from "@/lib/api";
import { useLiveConnection, useLiveEvent } from "@/lib/live";
import { liveTicket } from "@/lib/live-actions";
import { DEFAULT_PREF, PREF_KEY, parsePref, resolveBackground, type WallpaperPref } from "@/lib/wallpaper";
import { deleteUpload, loadUpload, saveUpload } from "@/lib/wallpaper-store";
import { AddressBar } from "./AddressBar";
import {
  IconBin,
  IconDiary,
  IconDisplay,
  IconGuestbook,
  IconHeart,
  IconMessenger,
  IconMixtape,
  IconPhotos,
  IconTonight,
  IconWrite,
} from "./Icons";
import { Ink, nudgeInk } from "./ink/Ink";
import { Notifications } from "./Notifications";
import { type Pos, Window } from "./Window";
import { Account } from "./windows/Account";
import { Almost } from "./windows/Almost";
import { Diary } from "./windows/Diary";
import { DisplayProperties, paintStyle } from "./windows/DisplayProperties";
import { Guestbook } from "./windows/Guestbook";
import { Messenger } from "./windows/Messenger";
import { Mixtape } from "./windows/Mixtape";
import { Photos, type Picture } from "./windows/Photos";
import { Tonight } from "./windows/Tonight";
import { Write } from "./windows/Write";

export type DesktopData = {
  /** The member whose desktop this is; null on the front desktop. */
  owner: Profile | null;
  entry: Entry | null;
  /** The owner's pages, or everyone's on the front desktop. */
  entries: EntrySummary[];
  /** Everyone's newest pages, for the Tonight window. */
  recent: EntrySummary[];
  notes: Note[];
  shouts: Shout[];
  blasts: Blast[];
  almost: AlmostItem[];
  cat: CatStats;
};

type WinId = "tonight" | "diary" | "msn" | "guest" | "amp" | "photos" | "almost" | "write" | "display" | "account";
type WinState = { open: boolean; min: boolean; z: number; pos?: Pos };

const WINDOWS: Record<WinId, { title: string; task: string; icon: (c?: string) => ReactNode; className: string }> = {
  tonight: {
    title: "Tonight — everyone's nights",
    task: "Tonight",
    icon: (c) => <IconTonight className={c} />,
    className: "w-tonight",
  },
  diary: { title: "diary.doc", task: "diary", icon: (c) => <IconDiary className={c} />, className: "w-diary" },
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
    task: "My Pictures",
    icon: (c) => <IconPhotos className={c} />,
    className: "w-photos",
  },
  almost: {
    title: "Almost posted",
    task: "Almost posted",
    icon: (c) => <IconBin className={c} />,
    className: "w-almost",
  },
  write: {
    title: "Notepad — write tonight's page",
    task: "Notepad",
    icon: (c) => <IconWrite className={c} />,
    className: "w-write",
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
const ICON_ORDER: Array<[WinId, string]> = [
  ["tonight", "Tonight"],
  ["diary", "Diary"],
  ["msn", "Messenger"],
  ["guest", "Guestbook"],
  ["amp", "Mixtape"],
  ["photos", "Photos"],
  ["almost", "Almost posted"],
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

export function Desktop({ data }: { data: DesktopData }) {
  const { entry, entries, owner } = data;
  /** Who Messenger, the blasts and the bin are about: the desktop's owner, or whoever wrote the page that is open. */
  const persona: Author | null = owner ?? entry?.author ?? null;
  const personaHandle = persona?.handle;
  const [wins, setWins] = useState<Record<WinId, WinState>>({
    // The front desktop opens on everyone's newest pages; a member's desktop opens on their diary.
    tonight: { open: !owner, min: false, z: 14 },
    diary: { open: true, min: false, z: 13 },
    msn: { open: true, min: false, z: 12 },
    amp: { open: true, min: false, z: 11 },
    write: { open: false, min: false, z: 10 },
    guest: { open: false, min: false, z: 10 },
    photos: { open: false, min: false, z: 10 },
    almost: { open: false, min: false, z: 10 },
    display: { open: false, min: false, z: 10 },
    account: { open: false, min: false, z: 10 },
  });
  const [focus, setFocus] = useState<WinId>("diary");
  const zTop = useRef(20);
  const [startOpen, setStartOpen] = useState(false);
  const [skin, setSkin] = useLocal<SkinId>(
    "4me-skin",
    "midnight",
    SKINS.map((s) => s.id),
  );
  const [preview, setPreview] = useState<boolean | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [clock, setClock] = useState("");
  const [shaking, setShaking] = useState(false);
  const [cat, setCat] = useState(data.cat);
  const [live, setLive] = useState<NowPlaying | null>(null);
  const [photoView, setPhotoView] = useState<number | null>(null);
  const [wallPref, setWallPref] = useState<WallpaperPref>(DEFAULT_PREF);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [deskMenu, setDeskMenu] = useState<{ x: number; y: number } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  /** The page open in Notepad: null for a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const path = usePathname() ?? "/";
  const startBtn = useRef<HTMLButtonElement>(null);
  const startMenu = useRef<HTMLDivElement>(null);
  const router = useRouter();

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

  const pictures = useMemo<Picture[]>(() => {
    const seen = new Set<string>();
    const list: Picture[] = [];
    for (const p of entry?.photos ?? [])
      if (!seen.has(p.url) && seen.add(p.url)) list.push({ ...p, night: entry!.slug });
    for (const e of entries)
      if (e.cover && !seen.has(e.cover.url) && seen.add(e.cover.url)) list.push({ ...e.cover, night: e.slug });
    return list;
  }, [entry, entries]);

  /* clock, the reader's hour, film grain, live listening */
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setHour(d.getHours());
      setClock(hhmm(d));
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
    const loadLive = () =>
      fetch(`${API_URL}/now-playing${personaHandle ? `?user=${encodeURIComponent(personaHandle)}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v: NowPlaying | null) => setLive(v))
        .catch(() => undefined);
    void loadLive();
    const l = window.setInterval(loadLive, 60_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(l);
    };
  }, [personaHandle]);

  useEffect(() => {
    document.body.dataset.skin = skin;
    document.body.classList.toggle("daytime", !awake);
  }, [skin, awake]);

  useEffect(() => {
    if (entry) void apiSend(`/entries/${entry.id}/read`);
  }, [entry]);

  /* who is signed in: asked after the page renders, so the page itself can be cached for everyone */
  useEffect(() => {
    fetch("/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: Me | null) => setMe(v))
      .catch(() => undefined);
  }, []);

  /* the reader's own wallpaper: the choice in localStorage, their picture in IndexedDB */
  useEffect(() => {
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
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

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
    if ((e.target as Element).closest(".win, .icon, button, a, input, textarea, select")) return;
    e.preventDefault();
    setDeskMenu({ x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 140) });
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
  const patch = (id: WinId, p: Partial<WinState>) => setWins((w) => ({ ...w, [id]: { ...w[id], ...p } }));
  const taskClick = (id: WinId) => {
    const w = wins[id];
    if (w.min) open(id);
    else if (focus === id) patch(id, { min: true });
    else raise(id);
  };

  const ownBuzz = useRef(0);
  const buzz = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShaking(false);
    window.requestAnimationFrame(() => setShaking(true));
    window.setTimeout(() => setShaking(false), 650);
  };

  /* live: this page's notes and BUZZes, this guestbook, new pages, and (signed in) my notifications */
  const topics = useMemo(
    () => [entry ? `entry:${entry.id}` : "", `guest:${owner?.handle ?? "_"}`, "tonight"].filter(Boolean),
    [entry, owner],
  );
  const liveState = useLiveConnection(topics, me ? liveTicket : null);
  useLiveEvent((e) => {
    // A BUZZ from someone else reading the same page shakes this screen too (my own already did).
    if (e.type === "buzz" && e.entryId === entry?.id && Date.now() - ownBuzz.current > 2500) buzz();
  });

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("open");
    if (want && want in WINDOWS && want !== "account") open(want as WinId);
  }, [open]);

  const write = (id: number | null) => {
    setEditing(id);
    open("write");
  };

  const showPhoto = (url: string) => {
    const i = pictures.findIndex((p) => p.url === url);
    setPhotoView(i >= 0 ? i : 0);
    open("photos");
  };

  const content: Record<WinId, ReactNode> = {
    tonight: <Tonight key={data.recent[0]?.id ?? 0} recent={data.recent} me={me} onWrite={() => write(null)} />,
    diary: (
      <Diary
        entry={entry}
        entries={entries}
        owner={owner}
        awake={awake}
        me={me}
        onEdit={write}
        onPhoto={showPhoto}
        onSong={() => open("amp")}
        onNotes={() => open("msn")}
        onGuestbook={() => open("guest")}
      />
    ),
    msn: (
      <Messenger
        key={entry?.id ?? "none"}
        entry={entry}
        persona={persona}
        notes={data.notes}
        blasts={data.blasts}
        awake={awake}
        live={live}
        onBuzz={() => {
          ownBuzz.current = Date.now();
          buzz();
        }}
        me={me}
      />
    ),
    guest: <Guestbook key={owner?.handle ?? "_"} initial={data.shouts} me={me} owner={owner} />,
    amp: <Mixtape entries={entries} currentId={entry?.id} live={live} persona={persona} />,
    photos: <Photos pictures={pictures} view={photoView} onView={setPhotoView} />,
    almost: <Almost items={data.almost} persona={persona} />,
    write: me ? (
      <Write
        me={me}
        editing={editing}
        onEditing={setEditing}
        onSaved={(e) => {
          patch("write", { open: false, min: false });
          router.push(`/u/${e.author.handle}/${e.slug}`);
        }}
        onDeleted={() => router.push(`/u/${me.handle}`)}
      />
    ) : (
      <div className="body acc">
        <p>
          Everyone here keeps a night diary.{" "}
          <a href={`/welcome?next=${encodeURIComponent(path)}`}>Log on or create an account</a> to write yours.
        </p>
      </div>
    ),
    display: (
      <DisplayProperties
        pref={wallPref}
        skinWall={skinWall}
        uploadUrl={uploadUrl}
        onApply={applyWallpaper}
        onClose={() => patch("display", { open: false, min: false })}
        onUpload={storeUpload}
        onRemoveUpload={removeUpload}
      />
    ),
    account: me ? (
      <Account me={me} onMe={setMe} />
    ) : (
      <div className="body acc">
        <p>
          You&apos;re not logged on.{" "}
          <a href={`/welcome?next=${encodeURIComponent(path)}`}>Log on or create an account</a>.
        </p>
      </div>
    ),
  };

  const visible = (Object.keys(WINDOWS) as WinId[]).filter((id) => wins[id].open);

  /** Every window says whose it is: you are always on your own computer, reading someone's diary. */
  const whose = persona && persona.handle !== me?.handle ? `${persona.name}'s` : persona ? "My" : null;
  const titleOf = (id: WinId): string => {
    if (id === "diary" && entry) return `${entry.author.name} — ${entry.title}.doc`;
    if (id === "msn" && persona) return `Messenger — ${persona.name}`;
    if (id === "guest") return owner ? `${owner.name}'s guestbook` : "Guestbook — everyone";
    if (id === "amp" && whose) return `${whose} mixtape.m3u`;
    if (id === "photos" && whose) return `${whose} pictures`;
    if (id === "almost" && whose) return `${whose} almost posted`;
    if (id === "write" && editing) return "Notepad — editing a page";
    return WINDOWS[id].title;
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click on empty desktop; the same actions are in the Start menu */}
      <div className={`desk${shaking ? " shake" : ""}`} onContextMenu={onDeskContext}>
        <div className="wall" aria-hidden="true">
          <div className={`paint ${paintClass}`} style={paintStyle(background)} />
        </div>
        <nav className="icons" aria-label="Desktop">
          {ICON_ORDER.map(([id, label]) =>
            id === "diary" ? (
              <span key={id} className="icon-pair">
                <a className="icon" href={me ? `/u/${me.handle}` : "/welcome?start=register"}>
                  <img className="icon-av" src={me ? avatarUrl(me.avatar) : "/photos/pic-229.jpg"} alt="" />
                  {me ? "My diary" : "Start a diary"}
                </a>
                {entry && (
                  <button type="button" className="icon" onClick={() => open("diary")}>
                    {WINDOWS.diary.icon()}
                    {entry.author.handle === me?.handle ? "This page" : `${entry.author.name}'s diary`}
                  </button>
                )}
              </span>
            ) : (
              <button key={id} type="button" className="icon" onClick={() => open(id)}>
                {WINDOWS[id].icon()}
                {label}
              </button>
            ),
          )}
          <button type="button" className="icon" onClick={() => write(null)}>
            {WINDOWS.write.icon()}
            Notepad
          </button>
        </nav>
        {visible.map((id) =>
          wins[id].min ? null : (
            <Window
              key={id}
              id={`win-${id}`}
              title={titleOf(id)}
              icon={WINDOWS[id].icon()}
              className={WINDOWS[id].className}
              focused={focus === id}
              z={wins[id].z}
              pos={wins[id].pos}
              onFocus={() => focus !== id && raise(id)}
              onMinimise={() => patch(id, { min: true })}
              onClose={() => patch(id, { open: false, min: false })}
              onMove={(pos) => patch(id, { pos })}
            >
              {content[id]}
            </Window>
          ),
        )}
      </div>

      {startOpen && (
        <div className="startmenu" ref={startMenu} id="startmenu" role="menu" aria-label="Start">
          <div className="sm-head">
            <img src={me ? avatarUrl(me.avatar) : "/photos/pic-229.jpg"} alt="" width={44} height={44} />
            <div>
              <b>{me ? me.displayName : "Guest"}</b>
              <span>{me ? `/u/${me.handle}` : "log on to keep a diary"}</span>
            </div>
          </div>
          <ul className="sm-list">
            {ICON_ORDER.map(([id, label]) => (
              <li key={id}>
                <button type="button" role="menuitem" onClick={() => open(id)}>
                  {WINDOWS[id].icon()}
                  {id === "diary" ? (owner ? `${owner.name}'s diary` : "The page that's open") : label}
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="menuitem" onClick={() => write(null)}>
                {WINDOWS.write.icon()}
                Write tonight&apos;s page
              </button>
            </li>
            {me && (
              <li>
                <a href={`/u/${me.handle}`} role="menuitem">
                  <img className="sm-av" src={avatarUrl(me.avatar)} alt="" width={24} height={24} />
                  My diary
                </a>
              </li>
            )}
            {(owner || path !== "/") && (
              <li>
                <a href="/" role="menuitem">
                  {WINDOWS.tonight.icon()}
                  Home: tonight&apos;s pages
                </a>
              </li>
            )}
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
              <a href={owner ? `/u/${owner.handle}/rss.xml` : "/rss.xml"} role="menuitem">
                RSS feed
              </a>
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
                <a href={`/welcome?next=${encodeURIComponent(path)}`} role="menuitem">
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
              router.refresh();
            }}
          >
            Refresh
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
        <AddressBar path={path} />
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
          <button type="button" className="preview" aria-pressed={preview !== null} onClick={() => setPreview(!awake)}>
            {awake ? "Preview daytime" : "Preview night"}
          </button>
          <span className="clock">{clock}</span>
        </div>
      </footer>
    </>
  );
}
