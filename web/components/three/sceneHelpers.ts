"use client";

// Small helpers shared by the 3D scenes: the site's colors, so the scenes
// follow the palette in globals.css, and the "Reduce motion" setting.

import { useEffect, useState } from "react";

/** A CSS color token from :root, such as "--accent", or the fallback before the page has styles. */
export function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** True while macOS (or any system) asks for less motion; follows changes live. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** True when this browser can draw WebGL; checked once, in the browser only. */
export function canUseWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false; // some locked-down browsers throw instead of returning null
  }
}
