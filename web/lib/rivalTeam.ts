// A rival's team as the team panel draws it (components/leagues/TeamPanel.tsx).
// FPL's picks give positions 1 to 11 for the starters and 12 to 15 for the
// bench, with each player's multiplier (2 captain, 3 Triple Captain, 0
// bench). This turns them into the shared pitch's inputs: each player's
// name, club and position, a tag with the points he scored for that team,
// and the players you own too.

import type { PitchPlayer, Position } from "./types.ts";

/** One pick from FPL's entry/{id}/event/{gw}/picks/. */
export interface FplPick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

/** What a player's tag on the pitch says (the same shape as BroadcastPitch's PlayerTag). */
export interface PointsTag {
  text: string;
  label: string;
  tone: "good" | "short" | "plain";
}

export interface RivalTeam {
  starters: number[];
  bench: number[];
  captain: number;
  viceCaptain: number;
  players: Record<string, PitchPlayer>;
  tags: Map<number, PointsTag>;
  shared: number[]; // players you own too
}

const STARTING_POSITIONS = 11;
const POSITIONS: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

/**
 * The pitch for a rival's picks. `points` is each player's points that week,
 * `elements` the live picks table ({id: [club id, position 1-4, short name]}),
 * `clubs` club ids to short names and `mine` the players in your squad.
 */
export function rivalTeam(
  picks: FplPick[],
  points: Map<number, number>,
  elements: Record<string, [number, number, string?]>,
  clubs: Map<number, string>,
  mine: Set<number>,
): RivalTeam {
  const ordered = [...picks].sort((a, b) => a.position - b.position);
  const starters = ordered.filter((pick) => pick.position <= STARTING_POSITIONS);
  const players: Record<string, PitchPlayer> = {};
  const tags = new Map<number, PointsTag>();
  for (const pick of ordered) {
    const [club, type, name] = elements[String(pick.element)] ?? [0, 3, undefined];
    players[String(pick.element)] = { id: pick.element, name: name ?? `#${pick.element}`, team: clubs.get(club) ?? "", position: POSITIONS[type] ?? "MID", xp: {} };
    tags.set(pick.element, pointsTag(points.get(pick.element) ?? 0, pick));
  }
  return {
    starters: starters.map((pick) => pick.element),
    bench: ordered.filter((pick) => pick.position > STARTING_POSITIONS).map((pick) => pick.element),
    captain: ordered.find((pick) => pick.is_captain)?.element ?? -1,
    viceCaptain: ordered.find((pick) => pick.is_vice_captain)?.element ?? -1,
    players,
    tags,
    shared: ordered.filter((pick) => mine.has(pick.element)).map((pick) => pick.element),
  };
}

// A starter's tag shows what he scored for the team (captains doubled or tripled); a bench player's shows his own points.
function pointsTag(points: number, pick: FplPick): PointsTag {
  if (pick.position > STARTING_POSITIONS && pick.multiplier === 0) {
    return { text: String(points), label: `${points} points on the bench`, tone: "plain" };
  }
  const earned = points * Math.max(1, pick.multiplier);
  return { text: String(earned), label: `${earned} points`, tone: "plain" };
}
