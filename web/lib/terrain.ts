// The Fixture Ticker as a 3D terrain. Each club gets a row and each
// gameweek a column, in the same order as the table: the block's height is
// how hard that week is (a double adds both matches, a blank is flat), and
// its color comes from the average difficulty, 1 easiest to 5 hardest.

import type { FixtureTicker, TickerMatch, TickerTeam } from "./types";

export type TerrainMode = "attack" | "defence";

export const DIFFICULTY_LABELS = ["Easiest", "Easy", "Medium", "Hard", "Hardest"];

export interface TerrainColumn {
  teamId: number;
  gameweek: number;
  row: number; // club, 0 = best run (the table's top row)
  col: number; // gameweek, 0 = the next one
  height: number; // difficulty added up over the week's matches; 0 for a blank
  level: number; // average difficulty rounded, 1 to 5; 0 for a blank
  mine: boolean; // you own a player from this club
  label: string; // what the hover note says
}

export interface Terrain {
  teams: { id: number; name: string }[];
  weeks: number[];
  columns: TerrainColumn[];
}

/** One block per club and shown gameweek, ranked like the table for the chosen mode and window. */
export function terrainColumns(ticker: FixtureTicker, mode: TerrainMode, windowLength: number, myTeamIds: number[]): Terrain {
  const score = (team: TickerTeam) => team.scores[mode][String(windowLength)];
  const teams = [...ticker.teams].sort((a, b) => score(b) - score(a));
  const weeks = ticker.weeks.slice(0, windowLength);
  const columns = teams.flatMap((team, row) =>
    weeks.map((gameweek, col) => weekColumn(team, gameweek, row, col, mode, myTeamIds.includes(team.id))));
  return { teams: teams.map(({ id, name }) => ({ id, name })), weeks, columns };
}

// One club's gameweek as a block: its height, color level and hover note.
function weekColumn(team: TickerTeam, gameweek: number, row: number, col: number, mode: TerrainMode, mine: boolean): TerrainColumn {
  const matches = team.matches[String(gameweek)] ?? [];
  const levels = matches.map((match) => difficulty(match, mode));
  const height = levels.reduce((sum, level) => sum + level, 0);
  const level = matches.length === 0 ? 0 : Math.round(height / matches.length);
  return { teamId: team.id, gameweek, row, col, height, level, mine, label: columnLabel(team.name, gameweek, matches, levels) };
}

// The difficulty that matters for attackers or for defenders.
function difficulty(match: TickerMatch, mode: TerrainMode): number {
  return mode === "attack" ? match.attackDifficulty : match.defenceDifficulty;
}

// "ARS v CHE (H), GW14: Hard", a double as "ARS v LIV (A) Hardest, BUR (H) Easiest, GW16", a blank as "ARS, GW15: no match".
function columnLabel(name: string, gameweek: number, matches: TickerMatch[], levels: number[]): string {
  if (matches.length === 0) return `${name}, GW${gameweek}: no match`;
  const opponent = (match: TickerMatch) => `${match.opponent} (${match.isHome ? "H" : "A"})`;
  if (matches.length === 1) return `${name} v ${opponent(matches[0])}, GW${gameweek}: ${DIFFICULTY_LABELS[levels[0] - 1]}`;
  const each = matches.map((match, index) => `${opponent(match)} ${DIFFICULTY_LABELS[levels[index] - 1]}`);
  return `${name} v ${each.join(", ")}, GW${gameweek}`;
}
