"use client";

// The Broadcast-style pitch with substitutes, shared by the Dashboard, the
// Planner and the Review. Every player sits in the same fixed-size slot
// (shirt, name plate, tag), so long names never push the layout around.
// The tag shows this week's xP, or what the page gives instead (the Review
// shows real points). What a click does is up to the page.

import { formatXp } from "@/lib/format";
import { formation, pitchRows } from "@/lib/dashboard";
import { rowDepthScale } from "@/lib/pitchDepth";
import type { Player } from "@/lib/types";
import { ClubKit } from "./ClubKit";

const SUB_LABELS = ["GK", "1ST SUB", "2ND SUB", "3RD SUB"];

interface BroadcastPitchProps {
  title: string;
  starters: number[];
  bench: number[];
  captain: number;
  viceCaptain: number; // takes the captain's double points if the captain doesn't play
  players: Record<string, Player>;
  week: number;
  onPlayerClick: (playerId: number) => void;
  selectedId?: number | null; // Planner: the player being replaced
  incomingIds?: number[]; // Planner: players bought this week
  hint?: string; // a short line under the title, e.g. "Click a player to replace him"
  tagFor?: (playerId: number) => PlayerTag; // replaces the xP tag (Review: points scored)
  benchNote?: string; // replaces the note beside "Substitutes"
}

/** What a player's tag says, and its color: lime when he beat his forecast, orange when he fell short. */
export interface PlayerTag {
  text: string;
  label: string; // the same for screen readers, e.g. "10 points"
  tone: "good" | "short" | "plain"; // plain: no forecast to compare with
}

export function BroadcastPitch(props: BroadcastPitchProps) {
  const { title, starters, bench, captain, viceCaptain, players, week, onPlayerClick, selectedId = null, incomingIds = [], hint, tagFor, benchNote } = props;
  const stateOf = (id: number) => (id === selectedId ? "selected" : incomingIds.includes(id) ? "incoming" : undefined);
  const rows = pitchRows(starters, players);
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
        {/* Only the turf tilts back; the players stand upright on top of it, so they stay easy to read and click. */}
        <div className="bc-pitch-turf" aria-hidden="true">
          <span className="bc-pitch-line bc-pitch-box" />
          <span className="bc-pitch-line bc-pitch-half" />
          <span className="bc-pitch-line bc-pitch-circle" />
        </div>
        {rows.map((row, index) => (
          <div key={row.join("-")} className="bc-pitch-row" style={{ "--depth": rowDepthScale(index, rows.length) } as React.CSSProperties}>
            {row.map((id) => (
              <PlayerToken
                key={id}
                player={players[id]}
                week={week}
                armband={id === captain ? "captain" : id === viceCaptain ? "vice" : undefined}
                state={stateOf(id)}
                tag={tagFor?.(id)}
                onClick={onPlayerClick}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="bc-subs">
        <div className="bc-subs-head">
          <span className="bc-title-small">SUBSTITUTES</span>
          <span className="bc-subs-note">{benchNote ?? "Come on in this order if a starter doesn't play"}</span>
        </div>
        <div className="bc-subs-row">
          {bench.map((id, index) => (
            <PlayerToken key={id} player={players[id]} week={week} subLabel={SUB_LABELS[index]} state={stateOf(id)} tag={tagFor?.(id)} onClick={onPlayerClick} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface PlayerTokenProps {
  player: Player;
  week: number;
  armband?: "captain" | "vice";
  subLabel?: string;
  state?: "selected" | "incoming";
  tag?: PlayerTag;
  onClick: (playerId: number) => void;
}

// One player: shirt, name plate and a tag (this week's xP unless the page gives another), in fixed rows.
function PlayerToken({ player, week, armband, subLabel, state, tag, onClick }: PlayerTokenProps) {
  const xp = formatXp(player.xp[String(week)] ?? 0);
  const tagText = tag ? tag.text : xp;
  const tagLabel = tag ? tag.label : `${xp} expected points`;
  const classes = ["bc-token"];
  if (subLabel) classes.push("bc-token-sub");
  if (state) classes.push(`bc-token-${state}`);
  if (armband === "captain") classes.push("bc-token-is-captain");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={() => onClick(player.id)}
      aria-pressed={state === "selected" ? true : undefined}
      aria-label={`${player.name}, ${player.team}, ${tagLabel}${armband === "captain" ? ", captain" : armband === "vice" ? ", vice-captain" : ""}${player.setPieces?.penalties === 1 ? ", takes penalties" : ""}`}
    >
      {subLabel && <span className="bc-token-order">{subLabel}</span>}
      <span className="bc-token-shirt">
        <ClubKit clubCode={player.team} isGoalkeeper={player.position === "GK"} width={subLabel ? 48 : 54} />
        {armband === "captain" && <span className="bc-token-captain">C</span>}
        {armband === "vice" && <span className="bc-token-captain bc-token-vice" title="Vice-captain">V</span>}
        {player.setPieces?.penalties === 1 && <span className="bc-token-pen" title="First-choice penalty taker">P</span>}
      </span>
      <span className="bc-token-name">{player.name}</span>
      <span className={tag ? `bc-token-xp bc-token-xp-${tag.tone}` : "bc-token-xp"}>{tagText}</span>
    </button>
  );
}
