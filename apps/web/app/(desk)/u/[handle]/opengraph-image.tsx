import type { EntrySummary, Profile } from "@4me/shared";
import { ImageResponse } from "next/og";
import { apiGet } from "@/lib/api";
import { C, clip, OG_SIZE, OgWindow, ogFonts, Polaroid, picture } from "@/lib/og";

export const alt = "A night diary on 4me";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

/** The preview for someone's diary: their picture, name, the line about them, and their newest pages. */
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [owner, pages, fonts] = await Promise.all([
    apiGet<Profile>(`/profiles/${encodeURIComponent(handle)}`, 300),
    apiGet<EntrySummary[]>(`/entries?author=${encodeURIComponent(handle)}&limit=3`, 300),
    ogFonts(),
  ]);
  if (!owner) return new ImageResponse(<OgWindow address="4me://not-found">{null}</OgWindow>, { ...size, fonts });
  const avatar = await picture(owner.avatar);
  return new ImageResponse(
    <OgWindow address={`4me://${owner.handle}`}>
      {avatar && (
        <div style={{ display: "flex", alignItems: "center", paddingRight: 48 }}>
          <Polaroid src={avatar} caption={owner.name} size={300} />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, justifyContent: "center" }}>
        <div style={{ display: "flex", fontFamily: "Reenie Beanie", fontSize: 46, color: C.amber }}>a night diary</div>
        <div style={{ display: "flex", fontFamily: "Newsreader", fontSize: 72, color: C.ink, lineHeight: 1 }}>
          {clip(owner.name, 24)}
        </div>
        {owner.bio && (
          <div style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "italic", fontSize: 32, color: C.dim }}>
            {clip(owner.bio, 90)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 18 }}>
          {(pages ?? []).map((p) => (
            <div key={p.id} style={{ display: "flex", fontFamily: "Newsreader", fontSize: 28, color: C.ink }}>
              {`· ${clip(p.title, 46)}`}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", fontFamily: "VT323", fontSize: 28, color: C.dim, marginTop: 10 }}>
          {`${owner.nights} ${owner.nights === 1 ? "night" : "nights"} · ${owner.subscribers} subscribed`}
        </div>
      </div>
    </OgWindow>,
    { ...size, fonts },
  );
}
