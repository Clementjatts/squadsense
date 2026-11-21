"use client";

// The Dashboard's pitch: the shared Broadcast pitch, where clicking a
// player opens his detail panel.

import type { Lineup, Player } from "@/lib/types";
import { BroadcastPitch } from "../BroadcastPitch";
import { useOpenPlayer } from "../PlayerPanel";

interface LineupBoardProps {
  lineup: Lineup;
  players: Record<string, Player>;
  week: number;
}

export function LineupBoard({ lineup, players, week }: LineupBoardProps) {
  const openPlayer = useOpenPlayer();
  return (
    <BroadcastPitch
      title="STARTING XI"
      starters={lineup.starters}
      bench={lineup.bench}
      captain={lineup.captain}
      viceCaptain={lineup.vice_captain}
      players={players}
      week={week}
      onPlayerClick={openPlayer}
    />
  );
}
