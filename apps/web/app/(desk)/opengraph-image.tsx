import type { EntrySummary } from "@4me/shared";
import { ImageResponse } from "next/og";
import { apiGet } from "@/lib/api";
import { C, clip, OG_SIZE, OgWindow, ogFonts, Polaroid, picture } from "@/lib/og";

export const alt = "4me: night diaries on a 2006 desktop";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

/** The front page's preview: what 4me is, and tonight's newest pages. */
export default async function Image() {
  const [pages, fonts, photo] = await Promise.all([
    apiGet<EntrySummary[]>("/entries?limit=4", 600),
    ogFonts(),
    picture("/photos/pic-229.jpg"),
  ]);
  return new ImageResponse(
    <OgWindow address="4me://tonight">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
        <div style={{ display: "flex", fontFamily: "VT323", fontSize: 120, color: C.ink, lineHeight: 0.9 }}>4me</div>
        <div style={{ display: "flex", fontFamily: "Newsreader", fontStyle: "italic", fontSize: 38, color: C.dim }}>
          Night diaries on a 2006 desktop.
        </div>
        <div style={{ display: "flex", fontFamily: "Reenie Beanie", fontSize: 44, color: C.amber, marginTop: 18 }}>
          written tonight
        </div>
        {(pages ?? []).map((p) => (
          <div key={p.id} style={{ display: "flex", fontFamily: "Newsreader", fontSize: 28, color: C.ink }}>
            {`${clip(p.title, 40)} — ${p.author.name}`}
          </div>
        ))}
      </div>
      {photo && (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Polaroid src={photo} caption="after dark" size={320} />
        </div>
      )}
    </OgWindow>,
    { ...size, fonts },
  );
}
