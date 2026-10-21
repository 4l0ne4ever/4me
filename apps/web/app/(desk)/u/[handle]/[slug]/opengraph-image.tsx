import { type Entry, excerpt } from "@4me/shared";
import { ImageResponse } from "next/og";
import { apiGet, hhmm, longDate } from "@/lib/api";
import { C, clip, OG_SIZE, OgWindow, ogFonts, Polaroid, picture } from "@/lib/og";

export const alt = "A page from a night diary on 4me";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

/** The preview a chat shows for one page: its date, title, mood, a few words, the song, and its first photo. */
export default async function Image({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params;
  const entry = await apiGet<Entry>(`/entries/by/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, 300);
  const fonts = await ogFonts();
  if (!entry) return new ImageResponse(<OgWindow address="4me://not-found">{null}</OgWindow>, { ...size, fonts });
  const sealed = Boolean(entry.sealedUntil);
  const photo = await picture(sealed ? entry.author.avatar : (entry.photos[0]?.url ?? entry.author.avatar));
  const avatar = await picture(entry.author.avatar);
  const words = sealed ? "" : clip(excerpt(entry.body, 200), 150);
  return new ImageResponse(
    <OgWindow address={`4me://${entry.author.handle}/${entry.slug}`}>
      <div style={{ width: photo ? 640 : 1000, display: "flex", flexDirection: "column", paddingRight: 24 }}>
        <div style={{ display: "flex", fontFamily: "Reenie Beanie", fontSize: 46, color: C.amber, marginBottom: 6 }}>
          {sealed ? "a sealed letter" : `${longDate(entry.writtenAt)} — ${hhmm(entry.writtenAt)}`}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Newsreader",
            fontStyle: "normal",
            fontSize: 60,
            lineHeight: 1.12,
            color: C.ink,
            marginBottom: 16,
          }}
        >
          {clip(entry.title, 70)}
        </div>
        {sealed ? (
          <div style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "italic", fontSize: 32, color: C.dim }}>
            {`Opens ${longDate(entry.sealedUntil!)}. Until then, only its writer can read it.`}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {entry.mood || entry.weather ? (
              <div
                style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "normal", fontSize: 26, color: C.dim }}
              >
                {[entry.mood && `mood: ${entry.mood}`, entry.weather && `weather: ${entry.weather}`]
                  .filter(Boolean)
                  .join("   ·   ")}
              </div>
            ) : null}
            {words ? (
              <div
                style={{
                  display: "flex",
                  fontFamily: "Newsreader",
                  fontStyle: "italic",
                  fontSize: 28,
                  lineHeight: 1.3,
                  color: C.ink,
                }}
              >
                {words}
              </div>
            ) : null}
          </div>
        )}
        <div style={{ flex: 1, display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {avatar && (
              <img
                src={avatar}
                width={52}
                height={52}
                style={{ objectFit: "cover", border: `3px solid ${C.dim}` }}
                alt=""
              />
            )}
            <div style={{ display: "flex", fontFamily: "Newsreader", fontSize: 30, color: C.ink }}>
              {entry.author.name}
            </div>
          </div>
          {entry.song && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "10px 18px",
                background: C.ticket,
                color: "#f6e9dc",
                transform: "rotate(-2deg)",
              }}
            >
              <div style={{ display: "flex", fontFamily: "VT323", fontSize: 22 }}>ON REPEAT</div>
              <div style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "normal", fontSize: 26 }}>
                {clip(`${entry.song.title} — ${entry.song.artist}`, 40)}
              </div>
            </div>
          )}
        </div>
      </div>
      {photo && (
        <div style={{ display: "flex", alignItems: "center", paddingTop: 10 }}>
          <Polaroid src={photo} caption={sealed ? "✉" : clip(entry.photos[0]?.caption ?? "", 28)} size={330} />
        </div>
      )}
    </OgWindow>,
    { ...size, fonts },
  );
}
