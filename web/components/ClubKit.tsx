// A flat football shirt in a club's colors, drawn as SVG.
// Colors come from a small table keyed by FPL's three-letter club code, so
// nothing is fetched. A code missing from the table gets a plain navy and
// lime shirt instead of breaking the pitch.

interface KitPalette {
  body: string;
  sleeves: string;
  trim: string;
}

const DEFAULT_KIT: KitPalette = { body: "#233252", sleeves: "#1a2640", trim: "#b7f34a" };

// Every 2026/27 Premier League club, plus recently relegated ones so a
// promoted side next season still gets its colors. Approximate home kits.
const CLUB_KITS: Record<string, KitPalette> = {
  ARS: { body: "#dc2626", sleeves: "#f3f4f6", trim: "#f3f4f6" },
  AVL: { body: "#6d1d3a", sleeves: "#8cc6ec", trim: "#8cc6ec" },
  BHA: { body: "#1d5fd6", sleeves: "#1d5fd6", trim: "#ffffff" },
  BOU: { body: "#b91c1c", sleeves: "#111827", trim: "#e5e7eb" },
  BRE: { body: "#dc2626", sleeves: "#dc2626", trim: "#ffffff" },
  BUR: { body: "#6c1d45", sleeves: "#99d6ea", trim: "#fde047" },
  CHE: { body: "#1e40af", sleeves: "#1e40af", trim: "#93c5fd" },
  COV: { body: "#59c3e8", sleeves: "#59c3e8", trim: "#ffffff" },
  CRY: { body: "#1d4ed8", sleeves: "#b91c1c", trim: "#facc15" },
  EVE: { body: "#1e3a8a", sleeves: "#1e3a8a", trim: "#ffffff" },
  FUL: { body: "#f3f4f6", sleeves: "#f3f4f6", trim: "#111827" },
  HUL: { body: "#f5a12d", sleeves: "#111827", trim: "#111827" },
  IPS: { body: "#1b4aa0", sleeves: "#ffffff", trim: "#ffffff" },
  LEE: { body: "#f8fafc", sleeves: "#f8fafc", trim: "#eab308" },
  LIV: { body: "#c8102e", sleeves: "#c8102e", trim: "#fef2f2" },
  MCI: { body: "#6cabdd", sleeves: "#6cabdd", trim: "#ffffff" },
  MUN: { body: "#da291c", sleeves: "#da291c", trim: "#111827" },
  NEW: { body: "#1f2937", sleeves: "#111827", trim: "#f9fafb" },
  NFO: { body: "#dd1e26", sleeves: "#dd1e26", trim: "#ffffff" },
  SUN: { body: "#dc2626", sleeves: "#ffffff", trim: "#111827" },
  TOT: { body: "#f8fafc", sleeves: "#f8fafc", trim: "#1e293b" },
  WHU: { body: "#7a263a", sleeves: "#2daef0", trim: "#2daef0" },
  WOL: { body: "#f59e0b", sleeves: "#f59e0b", trim: "#111827" },
};

// Goalkeepers wear green so they stand apart from their own outfield players.
const GOALKEEPER_KIT: KitPalette = { body: "#16a34a", sleeves: "#15803d", trim: "#dcfce7" };

// Looks up a club's colors, falling back to the plain shirt for unknown codes.
function getClubKit(clubCode: string): KitPalette {
  return CLUB_KITS[clubCode.toUpperCase()] ?? DEFAULT_KIT;
}

interface ClubKitProps {
  clubCode: string;
  isGoalkeeper?: boolean;
  width?: number; // height follows the shirt's proportions
}

export function ClubKit({ clubCode, isGoalkeeper = false, width = 42 }: ClubKitProps) {
  const palette = isGoalkeeper ? GOALKEEPER_KIT : getClubKit(clubCode);
  const outline = { stroke: "#0b1220", strokeOpacity: 0.45, strokeWidth: 1.5 };
  return (
    <svg width={width} height={Math.round((width * 60) / 64)} viewBox="0 0 64 60" fill="none" aria-hidden="true">
      {/* Sleeves */}
      <path d="M18 8 L4 18 L10 31 L18 26 Z" fill={palette.sleeves} {...outline} />
      <path d="M46 8 L60 18 L54 31 L46 26 Z" fill={palette.sleeves} {...outline} />
      {/* Body */}
      <path d="M18 8 L24 6 Q32 13 40 6 L46 8 L47 54 Q32 56 17 54 Z" fill={palette.body} {...outline} />
      {/* Collar */}
      <path d="M24 6 Q32 14 40 6" stroke={palette.trim} strokeWidth="2.5" strokeLinecap="round" />
      {/* A faint highlight down the middle for a little depth */}
      <path d="M32 12 V54" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="10" />
    </svg>
  );
}
