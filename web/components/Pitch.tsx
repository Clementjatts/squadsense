// Draws the starting eleven on a pitch, goalkeeper at the top.
// Used read-only on the Dashboard and clickable in the Planner.

import { formatXp } from "@/lib/format";
import type { Player, Position } from "@/lib/types";

const ROW_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

interface PitchProps {
  starters: number[];
  captain: number;
  players: Record<string, Player>;
  week: number;
  selectedId?: number | null;
  incomingIds?: number[];
  onPlayerClick?: (playerId: number) => void;
}

// A short warning badge: availability first, then one booking from a ban.
function flagText(player: Player): string | null {
  if (player.chance !== null && player.chance < 100) return `${player.chance}%`;
  if (player.yellowCards === 4 || player.yellowCards === 9) return `${player.yellowCards}Y`;
  return null;
}

export function Pitch({ starters, captain, players, week, selectedId, incomingIds = [], onPlayerClick }: PitchProps) {
  return (
    <div className="pitch">
      {ROW_ORDER.map((position) => (
        <div className="pitch-row" key={position}>
          {starters
            .map((id) => players[id])
            .filter((player) => player.position === position)
            .map((player) => {
              const flag = flagText(player);
              const classes = ["kit"];
              if (player.id === selectedId) classes.push("selected");
              if (incomingIds.includes(player.id)) classes.push("incoming");
              return (
                <button
                  key={player.id}
                  type="button"
                  className={classes.join(" ")}
                  onClick={onPlayerClick ? () => onPlayerClick(player.id) : undefined}
                  disabled={!onPlayerClick}
                  aria-label={`${player.name}, ${player.team}, ${formatXp(player.xp[String(week)] ?? 0)} expected points`}
                >
                  <span className="kit-shirt">
                    {player.id === captain && <span className="badge captain">C</span>}
                    {flag && <span className="badge flag">{flag}</span>}
                  </span>
                  <span className="kit-name">{player.name}</span>
                  <span className="kit-meta">
                    {player.team} · <b>{formatXp(player.xp[String(week)] ?? 0)}</b>
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
