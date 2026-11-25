"use client";

// Loads the 3D fixture terrain only when someone picks the 3D view, so the
// Fixture Ticker's table never waits for Three.js. Without WebGL it says so
// and points back to the table.

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Terrain } from "@/lib/terrain";
import { canUseWebGl } from "./sceneHelpers";

const FixtureTerrain = dynamic(() => import("./FixtureTerrain"), {
  ssr: false,
  loading: () => <p className="terrain-status">Loading the 3D view…</p>,
});

export function TerrainView({ terrain, highlightMine }: { terrain: Terrain; highlightMine: boolean }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(canUseWebGl()), []);
  if (supported === null) return null;
  if (!supported) return <p className="terrain-status">This browser can&apos;t show 3D. The table has the same fixtures.</p>;
  return <FixtureTerrain terrain={terrain} highlightMine={highlightMine} />;
}
