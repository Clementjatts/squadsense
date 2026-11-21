// GET /api/live: live points for your team and every team in your
// mini-leagues, for the gameweek being played. FPL's live data is cached
// for a minute, so however many tabs are open we ask FPL at most twice a
// minute (live points plus fixtures).

import { NextResponse } from "next/server";
import { playerLivePoints, teamLivePoints, type LiveElement, type LiveFixture } from "@/lib/live";
import { getLivePicks, getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const FPL_API = "https://fantasy.premierleague.com/api";
const CACHE_SECONDS = 60;

// Fetches one FPL endpoint through Next's cache. Throws with the status on failure.
async function fetchFpl<T>(path: string): Promise<T> {
  const response = await fetch(`${FPL_API}/${path}`, { next: { revalidate: CACHE_SECONDS } });
  if (!response.ok) throw new Error(`FPL ${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function GET() {
  const livePicks = await getLivePicks();
  if (!livePicks) {
    return NextResponse.json({ error: "No live picks yet. Run the sync job after the deadline." }, { status: 404 });
  }
  const week = livePicks.gameweek;
  let live: { elements: LiveElement[] };
  let fixtures: LiveFixture[];
  try {
    [live, fixtures] = await Promise.all([
      fetchFpl<{ elements: LiveElement[] }>(`event/${week}/live/`),
      fetchFpl<LiveFixture[]>(`fixtures/?event=${week}`),
    ]);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }

  const players = playerLivePoints(live.elements, fixtures, livePicks.elements);
  const mine = livePicks.mine ? teamLivePoints(livePicks.mine, players, livePicks.elements) : null;
  const { snapshot } = await getSnapshot();
  const clubNames = new Map(snapshot.fixtureTicker.teams.map((team) => [team.id, team.name]));

  return NextResponse.json({
    gameweek: week,
    fetchedAt: new Date().toISOString(),
    mine: mine && {
      ...mine,
      hits: livePicks.mine?.hits ?? 0,
      lineup: mine.lineup.map((line) => ({ ...line, ...players.get(line.element) })),
    },
    leagues: livePicks.leagues.map((league) => ({
      id: league.id,
      name: league.name,
      rows: league.teams
        .map((team) => {
          const result = team.picks.length > 0 ? teamLivePoints({ picks: team.picks, active_chip: team.chip }, players, livePicks.elements) : null;
          // totalBefore already has this week's hits taken off, so add the score before hits.
          const livePoints = result?.points ?? 0;
          return { entry: team.entry, teamName: team.teamName, live: livePoints, total: team.totalBefore + livePoints, chip: team.chip, playersLeft: result?.playersLeft ?? 0 };
        })
        .sort((a, b) => b.total - a.total),
    })),
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      home: clubNames.get(fixture.team_h) ?? String(fixture.team_h),
      away: clubNames.get(fixture.team_a) ?? String(fixture.team_a),
      homeScore: fixture.team_h_score,
      awayScore: fixture.team_a_score,
      minutes: fixture.minutes,
      status: fixture.finished || fixture.finished_provisional ? "done" : fixture.started ? "playing" : "waiting",
    })),
  });
}
