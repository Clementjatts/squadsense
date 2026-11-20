// Draws the starting eleven on a pitch, goalkeeper at the top.
// Used read-only on the Dashboard and clickable in the Planner.

import { formatXp } from "@/lib/format";
import { ClubKit } from "./ClubKit";
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

// Faint pitch markings behind the players: touchline, penalty box, six-yard
// box, penalty arc, halfway line and center circle. Decoration only, so
// screen readers skip it. "slice" keeps the center circle round at any width.
function PitchLines() {
  const line = { stroke: "rgba(207, 232, 214, 0.14)", strokeWidth: 1.5 };
  return (
    <svg className="pitch-lines" viewBox="0 0 600 440" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <rect x="20" y="16" width="560" height="408" rx="6" {...line} />
      <rect x="170" y="16" width="260" height="84" {...line} />
      <rect x="235" y="16" width="130" height="32" {...line} />
      <path d="M 250 100 A 62 62 0 0 0 350 100" {...line} />
      <line x1="20" y1="228" x2="580" y2="228" {...line} />
      <circle cx="300" cy="228" r="54" {...line} />
      <circle cx="300" cy="228" r="3" fill="rgba(207, 232, 214, 0.14)" />
    </svg>
  );
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
      <PitchLines />
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
                    <ClubKit clubCode={player.team} isGoalkeeper={player.position === "GK"} />
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
