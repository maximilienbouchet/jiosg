import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { LayoutEffects } from "../components/LayoutEffects";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "jio — Curated things to do in Singapore",
  description:
    "~10 curated events happening in Singapore this week. For people who are tired of digging through noise.",
  metadataBase: new URL(process.env.SITE_URL || "https://jiosg.app"),
  openGraph: {
    title: "jio — Curated things to do in Singapore",
    description:
      "~10 curated events happening in Singapore this week. Scraped, filtered, and ranked so you don't have to dig.",
    url: "/",
    siteName: "jio",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "jio — Curated things to do in Singapore",
    description:
      "~10 curated events happening in Singapore this week. Scraped, filtered, and ranked so you don't have to dig.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="antialiased">
        <LayoutEffects />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
