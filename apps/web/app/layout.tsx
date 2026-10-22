import type { Metadata, Viewport } from "next";
import { Newsreader, Reenie_Beanie, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-serif" });
const hand = Reenie_Beanie({ subsets: ["latin"], weight: "400", variable: "--font-hand" });
const lcd = VT323({ subsets: ["latin", "vietnamese"], weight: "400", variable: "--font-lcd" });

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "4me · night diaries", template: "%s · 4me" },
  description: "A night diary on a 2006 desktop. One entry after dark, with the mood, the weather and the song.",
  alternates: { types: { "application/rss+xml": "/rss.xml" } },
  openGraph: { type: "website", siteName: "4me" },
  twitter: { card: "summary_large_image" },
  // On an iPhone's home screen it opens in its own window, under a plain black status bar.
  appleWebApp: { capable: true, title: "4me", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#070a0e",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${hand.variable} ${lcd.variable}`}>
      <body data-skin="midnight">{children}</body>
    </html>
  );
}
