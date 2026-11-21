"use client";

// The Broadcast-style pitch with substitutes, shared by the Dashboard and
// the Planner. Every player sits in the same fixed-size slot (shirt, name
// plate, xP tag), so long names never push the layout around. What a click
// does is up to the page: open the player panel, or pick him to replace.

import { formatXp } from "@/lib/format";
import { formation, pitchRows } from "@/lib/dashboard";
import type { Player } from "@/lib/types";
import { ClubKit } from "./ClubKit";

const SUB_LABELS = ["GK", "1ST SUB", "2ND SUB", "3RD SUB"];

interface BroadcastPitchProps {
  title: string;
  starters: number[];
  bench: number[];
  captain: number;
  players: Record<string, Player>;
  week: number;
  onPlayerClick: (playerId: number) => void;
  selectedId?: number | null; // Planner: the player being replaced
  incomingIds?: number[]; // Planner: players bought this week
  hint?: string; // a short line under the title, e.g. "Click a player to replace him"
}

export function BroadcastPitch(props: BroadcastPitchProps) {
  const { title, starters, bench, captain, players, week, onPlayerClick, selectedId = null, incomingIds = [], hint } = props;
  const stateOf = (id: number) => (id === selectedId ? "selected" : incomingIds.includes(id) ? "incoming" : undefined);
  return (
    <section className="bc-card bc-lineup">
      <div className="bc-lineup-head">
        <span className="bc-title">{title}</span>
        <span className="bc-lineup-meta">
          {hint && <span className="bc-subs-note">{hint}</span>}
          <span className="bc-title-small bc-accent">{formation(starters, players)}</span>
        </span>
      </div>
      <div className="bc-pitch">
        <span className="bc-pitch-line bc-pitch-box" aria-hidden="true" />
        <span className="bc-pitch-line bc-pitch-half" aria-hidden="true" />
        <span className="bc-pitch-line bc-pitch-circle" aria-hidden="true" />
        {pitchRows(starters, players).map((row) => (
          <div key={row.join("-")} className="bc-pitch-row">
            {row.map((id) => (
              <PlayerToken key={id} player={players[id]} week={week} isCaptain={id === captain} state={stateOf(id)} onClick={onPlayerClick} />
            ))}
          </div>
        ))}
      </div>
      <div className="bc-subs">
        <div className="bc-subs-head">
          <span className="bc-title-small">SUBSTITUTES</span>
          <span className="bc-subs-note">Come on in this order if a starter doesn&apos;t play</span>
        </div>
        <div className="bc-subs-row">
          {bench.map((id, index) => (
            <PlayerToken key={id} player={players[id]} week={week} subLabel={SUB_LABELS[index]} state={stateOf(id)} onClick={onPlayerClick} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface PlayerTokenProps {
  player: Player;
  week: number;
  isCaptain?: boolean;
  subLabel?: string;
  state?: "selected" | "incoming";
  onClick: (playerId: number) => void;
}

// One player: shirt, name plate and this week's xP, in fixed rows.
function PlayerToken({ player, week, isCaptain = false, subLabel, state, onClick }: PlayerTokenProps) {
  const xp = formatXp(player.xp[String(week)] ?? 0);
  const classes = ["bc-token"];
  if (subLabel) classes.push("bc-token-sub");
  if (state) classes.push(`bc-token-${state}`);
  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={() => onClick(player.id)}
      aria-pressed={state === "selected" ? true : undefined}
      aria-label={`${player.name}, ${player.team}, ${xp} expected points${isCaptain ? ", captain" : ""}`}
    >
      {subLabel && <span className="bc-token-order">{subLabel}</span>}
      <span className="bc-token-shirt">
        <ClubKit clubCode={player.team} isGoalkeeper={player.position === "GK"} width={subLabel ? 48 : 54} />
        {isCaptain && <span className="bc-token-captain">C</span>}
      </span>
      <span className="bc-token-name">{player.name}</span>
      <span className="bc-token-xp">{xp}</span>
    </button>
  );
}
