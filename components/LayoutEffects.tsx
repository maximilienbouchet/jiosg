"use client";

import { usePathname } from "next/navigation";
import { BackgroundEffect } from "./BackgroundEffect";
import { MouseGlow } from "./MouseGlow";

export function LayoutEffects() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <>
      <BackgroundEffect />
      <MouseGlow />
    </>
  );
}
