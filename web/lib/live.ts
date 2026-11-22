// Live gameweek scoring: turns FPL's live points and fixtures into team
// totals, the way FPL will once the week is over. Two things FPL only
// settles later are worked out here in advance:
//
// - Provisional bonus: until FPL confirms bonus for a match, the three
//   highest BPS scores in it get 3, 2 and 1 (ties share, as FPL does).
// - Automatic substitutions: a starter who got no minutes, once his
//   club's matches are all over, is replaced by the first bench player
//   who played, as long as the formation stays legal.
//
// Pure functions only, so the API route and the page can share them.

import type { LivePick, LivePicks, LiveTeamPicks } from "./types";

export interface LiveFixture {
  id: number;
  event: number;
  started: boolean;
  finished: boolean;
  finished_provisional: boolean;
  minutes: number;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  stats: { identifier: string; h: { element: number; value: number }[]; a: { element: number; value: number }[] }[];
}

export interface LiveElement {
  id: number;
  stats: { minutes: number; total_points: number; bonus: number; bps: number };
}

export interface PlayerLive {
  points: number; // including provisional bonus
  provisionalBonus: number;
  minutes: number;
  status: "done" | "playing" | "waiting";
}

export interface TeamLive {
  points: number; // before hits, the way FPL shows a gameweek score
  lineup: { element: number; multiplier: number; subbedOn: boolean }[];
  subs: { out: number; in: number }[];
  playersLeft: number; // starters whose matches haven't finished
}

const MIN_IN_FORMATION: Record<number, number> = { 1: 1, 2: 3, 3: 2, 4: 1 };

/** FPL's bonus rule for one match: 3, 2, 1 down the BPS table, with ties sharing. */
export function bonusFromBps(bps: { element: number; value: number }[]): Map<number, number> {
  const bonus = new Map<number, number>();
  const values = [...new Set(bps.map((row) => row.value))].sort((a, b) => b - a);
  let pointsLeft = 3;
  for (const value of values) {
    if (pointsLeft <= 0) break;
    const tied = bps.filter((row) => row.value === value);
    for (const row of tied) bonus.set(row.element, pointsLeft);
    pointsLeft -= tied.length;
  }
  return bonus;
}

/** Provisional bonus for every player in a started match whose bonus FPL hasn't confirmed yet. */
export function provisionalBonus(fixtures: LiveFixture[]): Map<number, number> {
  const bonus = new Map<number, number>();
  for (const fixture of fixtures) {
    if (!fixture.started) continue;
    const confirmed = fixture.stats.find((stat) => stat.identifier === "bonus");
    if (confirmed && confirmed.h.length + confirmed.a.length > 0) continue;
    const bps = fixture.stats.find((stat) => stat.identifier === "bps");
    if (!bps) continue;
    for (const [element, points] of bonusFromBps([...bps.h, ...bps.a])) bonus.set(element, points);
  }
  return bonus;
}

/** Each player's live points, minutes and whether his matches are over. */
export function playerLivePoints(
  elements: LiveElement[],
  fixtures: LiveFixture[],
  clubs: LivePicks["elements"],
): Map<number, PlayerLive> {
  const bonus = provisionalBonus(fixtures);
  const liveById = new Map(elements.map((element) => [element.id, element]));
  const result = new Map<number, PlayerLive>();
  for (const [id, [club]] of Object.entries(clubs)) {
    const playerId = Number(id);
    const clubFixtures = fixtures.filter((fixture) => fixture.team_h === club || fixture.team_a === club);
    const live = liveById.get(playerId);
    const extra = bonus.get(playerId) ?? 0;
    result.set(playerId, {
      points: (live?.stats.total_points ?? 0) + extra,
      provisionalBonus: extra,
      minutes: live?.stats.minutes ?? 0,
      status: clubStatus(clubFixtures),
    });
  }
  return result;
}

// "done" once every match is over, "playing" while one is on, "waiting" before kick-off.
// A club with no match this week (a blank) counts as done.
function clubStatus(clubFixtures: LiveFixture[]): PlayerLive["status"] {
  if (clubFixtures.every((fixture) => fixture.finished || fixture.finished_provisional)) return "done";
  return clubFixtures.some((fixture) => fixture.started) ? "playing" : "waiting";
}

// True when swapping `outId` for `inId` keeps at least the minimum in each position.
function formationAllows(lineup: number[], outId: number, inId: number, positions: LivePicks["elements"]): boolean {
  const after = lineup.map((id) => (id === outId ? inId : id));
  return Object.entries(MIN_IN_FORMATION).every(
    ([position, minimum]) => after.filter((id) => positions[String(id)]?.[1] === Number(position)).length >= minimum,
  );
}

/** A team's live total with automatic substitutions and a vice-captain switch where FPL would make them. */
export function teamLivePoints(team: Pick<LiveTeamPicks, "picks" | "active_chip">, players: Map<number, PlayerLive>, positions: LivePicks["elements"]): TeamLive {
  const ordered = [...team.picks].sort((a, b) => a.position - b.position);
  const benchBoost = team.active_chip === "bboost";
  let starters = ordered.filter((pick) => pick.position <= 11).map((pick) => pick.element);
  const bench = ordered.filter((pick) => pick.position > 11);
  const subs: { out: number; in: number }[] = [];
  const didNotPlay = (id: number) => players.get(id)?.status === "done" && (players.get(id)?.minutes ?? 0) === 0;

  if (!benchBoost) {
    const usedBench = new Set<number>();
    for (const outId of starters.filter(didNotPlay)) {
      const isKeeper = positions[String(outId)]?.[1] === 1;
      const replacement = bench.find((pick) =>
        !usedBench.has(pick.element)
        && (positions[String(pick.element)]?.[1] === 1) === isKeeper
        && (players.get(pick.element)?.minutes ?? 0) > 0
        && formationAllows(starters, outId, pick.element, positions),
      );
      if (!replacement) continue;
      usedBench.add(replacement.element);
      starters = starters.map((id) => (id === outId ? replacement.element : id));
      subs.push({ out: outId, in: replacement.element });
    }
  }

  const counted = benchBoost ? ordered.map((pick) => pick.element) : starters;
  const lineup = counted.map((element) => ({
    element,
    multiplier: liveMultiplier(element, ordered, didNotPlay),
    subbedOn: subs.some((sub) => sub.in === element),
  }));
  const points = lineup.reduce((sum, line) => sum + (players.get(line.element)?.points ?? 0) * line.multiplier, 0);
  const playersLeft = starters.filter((id) => players.get(id)?.status !== "done").length;
  return { points, lineup, subs, playersLeft };
}

// The captain's multiplier moves to the vice-captain if the captain didn't play.
function liveMultiplier(element: number, picks: LivePick[], didNotPlay: (id: number) => boolean): number {
  const captain = picks.find((pick) => pick.is_captain);
  const vice = picks.find((pick) => pick.is_vice_captain);
  const captainMultiplier = Math.max(captain?.multiplier ?? 2, 2);
  if (captain && didNotPlay(captain.element) && vice && element === vice.element && !didNotPlay(vice.element)) return captainMultiplier;
  const pick = picks.find((candidate) => candidate.element === element);
  if (pick?.is_captain) return didNotPlay(element) ? 0 : captainMultiplier;
  return 1;
}

export interface OwnershipLine {
  element: number;
  eo: number; // effective ownership among rivals: 1.4 means 140% (captains count twice)
  mine: number; // your own multiplier: 0 benched or not owned, 1 starting, 2 captain, 3 triple captain
  net: number; // mine minus eo: how many of his points you gain on the average rival
  swing: number; // his live points times net: what he has gained (or cost) you so far
}

/**
 * Effective ownership in one mini-league: for every player in anyone's live
 * lineup, the average multiplier across your rivals, next to your own.
 * Uses the lineups after automatic subs, so a benched player who comes on
 * counts. The lines with the biggest net exposure come first.
 */
export function leagueOwnership(rivals: TeamLive[], mine: TeamLive | null, players: Map<number, PlayerLive>, shown: number): OwnershipLine[] {
  if (rivals.length === 0) return [];
  const rivalTotals = new Map<number, number>();
  for (const rival of rivals) {
    for (const line of rival.lineup) rivalTotals.set(line.element, (rivalTotals.get(line.element) ?? 0) + line.multiplier);
  }
  const myMultipliers = new Map((mine?.lineup ?? []).map((line) => [line.element, line.multiplier]));
  const elements = new Set([...rivalTotals.keys(), ...myMultipliers.keys()]);
  return [...elements]
    .map((element) => {
      const eo = (rivalTotals.get(element) ?? 0) / rivals.length;
      const own = myMultipliers.get(element) ?? 0;
      const net = own - eo;
      return { element, eo, mine: own, net, swing: net * (players.get(element)?.points ?? 0) };
    })
    .filter((line) => Math.abs(line.net) > 0.001)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || Math.abs(b.swing) - Math.abs(a.swing))
    .slice(0, shown);
}
