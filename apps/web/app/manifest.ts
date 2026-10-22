import type { MetadataRoute } from "next";

/** Added to a phone's home screen, 4me opens like an app: full screen, the cat as its icon, the night as its colour. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "4me · night diaries",
    short_name: "4me",
    description: "A night diary on a 2006 desktop. One entry after dark, with the mood, the weather and the song.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#070a0e",
    theme_color: "#070a0e",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The sky fills the whole square, so the same picture works when the phone crops it to a circle.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
