import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { BackgroundEffect } from "../components/BackgroundEffect";
import { MouseGlow } from "../components/MouseGlow";
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
  title: "SG Events — Curated things to do in Singapore",
  description:
    "~10 curated events happening in Singapore this week. For people who are tired of digging through noise.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="antialiased">
        <BackgroundEffect />
        <MouseGlow />
        {children}
      </body>
    </html>
  );
}
