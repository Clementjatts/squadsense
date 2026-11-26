// GET /api/teams/123 returns one FPL team's latest public lineup for the
// team panel on the Leagues page: its picks with each player's points that
// week, its value, bank and chip. FPL only shows a team's picks once a
// deadline has passed, so this is the latest week FPL has for it. Answers
// are cached: the team for an hour, the week's points for a minute.

import { NextResponse } from "next/server";
import { rivalTeam, type FplPick } from "@/lib/rivalTeam";
import { getLivePicks, getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const FPL_API = "https://fantasy.premierleague.com/api";
const TEAM_CACHE_SECONDS = 3600;
const POINTS_CACHE_SECONDS = 60;

// Fetches one FPL endpoint through Next's cache. Throws with the status on failure.
async function fetchFpl<T>(path: string, cacheSeconds: number): Promise<T> {
  const response = await fetch(`${FPL_API}/${path}`, { next: { revalidate: cacheSeconds } });
  if (!response.ok) throw new Error(`FPL ${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface FplEntry {
  name: string;
  player_first_name: string;
  player_last_name: string;
  current_event: number | null;
}

interface FplEntryPicks {
  active_chip: string | null;
  entry_history: { points: number; total_points: number; value: number; bank: number; event_transfers_cost: number };
  picks: FplPick[];
}

export async function GET(_request: Request, { params }: { params: Promise<{ entry: string }> }) {
  const { entry } = await params;
  const entryId = Number(entry);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json({ error: "Team id must be a positive whole number" }, { status: 400 });
  }
  const [livePicks, { snapshot }] = await Promise.all([getLivePicks(), getSnapshot()]);
  if (!livePicks) return NextResponse.json({ error: "Player names aren't loaded yet. Run the sync job." }, { status: 404 });

  try {
    const team = await fetchFpl<FplEntry>(`entry/${entryId}/`, TEAM_CACHE_SECONDS);
    if (!team.current_event) return NextResponse.json({ error: `${team.name} hasn't played a gameweek yet.` }, { status: 404 });
    const week = team.current_event;
    const [picks, live] = await Promise.all([
      fetchFpl<FplEntryPicks>(`entry/${entryId}/event/${week}/picks/`, TEAM_CACHE_SECONDS),
      fetchFpl<{ elements: { id: number; stats: { total_points: number } }[] }>(`event/${week}/live/`, POINTS_CACHE_SECONDS),
    ]);
    const points = new Map(live.elements.map((element) => [element.id, element.stats.total_points]));
    const clubs = new Map(snapshot.fixtureTicker.teams.map((club) => [club.id, club.name]));
    const pitch = rivalTeam(picks.picks, points, livePicks.elements, clubs, new Set(snapshot.squad));
    return NextResponse.json({
      entry: entryId,
      teamName: team.name,
      manager: `${team.player_first_name} ${team.player_last_name}`,
      gameweek: week,
      chip: picks.active_chip,
      points: picks.entry_history.points,
      transferCost: picks.entry_history.event_transfers_cost,
      value: picks.entry_history.value,
      bank: picks.entry_history.bank,
      starters: pitch.starters,
      bench: pitch.bench,
      captain: pitch.captain,
      viceCaptain: pitch.viceCaptain,
      players: pitch.players,
      tags: Object.fromEntries(pitch.tags),
      shared: pitch.shared,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
