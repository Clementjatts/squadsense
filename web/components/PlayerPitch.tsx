"use client";

// The Dashboard's pitch, where clicking a player opens his detail panel.
// The Planner uses Pitch directly, because there a click means "replace him".

import type { ComponentProps } from "react";
import { Pitch } from "./Pitch";
import { useOpenPlayer } from "./PlayerPanel";

export function PlayerPitch(props: Omit<ComponentProps<typeof Pitch>, "onPlayerClick">) {
  const openPlayer = useOpenPlayer();
  return <Pitch {...props} onPlayerClick={openPlayer} />;
}
