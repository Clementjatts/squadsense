// Small helpers that turn the snapshot into what the Dashboard's sections
// show. Kept apart from the components so each component stays short.

import type { Player, Position, PriceWatchRow, Snapshot } from "./types";

export interface FixtureChip {
  label: string; // e.g. "FUL H"
  difficulty: number; // 1 (easiest) to 5 (hardest)
}

// A player's next few matches from the Fixture Ticker. Keepers and
// defenders are rated on clean-sheet difficulty, everyone else on how
// many goals their club should score, the same as the ticker page.
export function nextFixtures(snapshot: Snapshot, player: Player, count: number): FixtureChip[] {
  const team = snapshot.fixtureTicker.teams.find((candidate) => candidate.id === player.teamId);
  if (!team) return [];
  const forDefence = player.position === "GK" || player.position === "DEF";
  const chips: FixtureChip[] = [];
  for (const week of snapshot.fixtureTicker.weeks) {
    for (const match of team.matches[String(week)] ?? []) {
      chips.push({
        label: `${match.opponent} ${match.isHome ? "H" : "A"}`,
        difficulty: forDefence ? match.defenceDifficulty : match.attackDifficulty,
      });
    }
  }
  return chips.slice(0, count);
}

const PITCH_ORDER: Position[] = ["FWD", "MID", "DEF", "GK"];
const TABLE_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

// The starting eleven as pitch rows, forwards at the top.
export function pitchRows(starters: number[], players: Record<string, Player>): number[][] {
  return PITCH_ORDER.map((position) => starters.filter((id) => players[id].position === position)).filter((row) => row.length > 0);
}

// "5-2-3": defenders, midfielders, forwards.
export function formation(starters: number[], players: Record<string, Player>): string {
  return (["DEF", "MID", "FWD"] as Position[]).map((position) => starters.filter((id) => players[id].position === position).length).join("-");
}

// Starters goalkeeper first, then the bench in its order.
export function tableOrder(starters: number[], bench: number[], players: Record<string, Player>): number[] {
  const sortedStarters = [...starters].sort(
    (a, b) => TABLE_ORDER.indexOf(players[a].position) - TABLE_ORDER.indexOf(players[b].position),
  );
  return [...sortedStarters, ...bench];
}

// The Price Watch row for a player, if FPL is tracking any movement for him.
export function priceRow(snapshot: Snapshot, playerId: number): PriceWatchRow | undefined {
  return snapshot.priceWatch.players.find((row) => row.id === playerId);
}
