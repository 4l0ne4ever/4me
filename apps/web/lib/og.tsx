import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

// Link previews (Open Graph images), drawn as a 2006 window: what a page looks like when it's shared in a chat.

export const OG_SIZE = { width: 1200, height: 630 };

const font = (file: string) => readFile(join(process.cwd(), "app/og-fonts", file));

export async function ogFonts() {
  const [serif, italic, hand, lcd] = await Promise.all([
    font("newsreader-500.ttf"),
    font("newsreader-italic.ttf"),
    font("reenie-beanie.ttf"),
    font("vt323.ttf"),
  ]);
  return [
    // Both registered at 400 so the face is chosen by style alone (the upright file is the medium weight).
    { name: "Newsreader", data: serif, weight: 400 as const, style: "normal" as const },
    { name: "Newsreader", data: italic, weight: 400 as const, style: "italic" as const },
    { name: "Reenie Beanie", data: hand, weight: 400 as const, style: "normal" as const },
    { name: "VT323", data: lcd, weight: 400 as const, style: "normal" as const },
  ];
}

/** The site's own pictures are read from disk; uploaded photos are fetched from the API as they are. */
export async function picture(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("https://")) return url;
  if (!url.startsWith("/photos/") || url.includes("..")) return null;
  try {
    const bytes = await readFile(join(process.cwd(), "public", url));
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export const C = {
  desk: "#070a0e",
  chrome: "#22304a",
  chromeInk: "#dfe6ef",
  paper: "#17130f",
  ink: "#efe6d6",
  dim: "#ab9f8b",
  amber: "#f0ac5c",
  ticket: "#9e392f",
};

/** A desktop at night with one window on it: an address in the title bar, a sheet of diary paper inside. */
export function OgWindow({ address, children }: { address: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 40,
        background: `linear-gradient(180deg, #0d1626 0%, ${C.desk} 100%)`,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          border: "2px solid #31415a",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 20px",
            background: C.chrome,
            color: C.chromeInk,
            fontFamily: "VT323",
            fontSize: 32,
          }}
        >
          <div style={{ width: 22, height: 26, background: "#9b4a39", borderLeft: "5px solid #5c2a20" }} />
          <div style={{ display: "flex", flex: 1 }}>{address}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#a2afc1" }}>_ ×</div>
        </div>
        <div style={{ flex: 1, display: "flex", background: C.paper, padding: "40px 48px", position: "relative" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A Polaroid, slightly crooked, with a handwritten caption. */
export function Polaroid({ src, caption, size = 360 }: { src: string; caption?: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "16px 16px 0",
        background: "#f4efe4",
        transform: "rotate(3deg)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
      }}
    >
      <img src={src} width={size} height={size} style={{ objectFit: "cover" }} alt="" />
      <div
        style={{
          display: "flex",
          height: 58,
          alignItems: "center",
          fontFamily: "Reenie Beanie",
          fontSize: 34,
          color: "#2a2420",
        }}
      >
        {caption ?? ""}
      </div>
    </div>
  );
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
