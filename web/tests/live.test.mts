// Checks for leagueOwnership in lib/live.ts with three made-up teams:
// effective ownership, your own multiplier, the net exposure and the
// points each player has gained or cost you so far.
// Run with: npm test

import { leagueOwnership, type PlayerLive, type TeamLive } from "../lib/live.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

// A team whose live lineup is the given [player, multiplier] pairs.
const team = (...lineup: [number, number][]): TeamLive => ({
  points: 0,
  lineup: lineup.map(([element, multiplier]) => ({ element, multiplier, subbedOn: false })),
  subs: [],
  playersLeft: 0,
});

// Player 1 scored 10, player 2 scored 6, player 3 scored 2.
const players = new Map<number, PlayerLive>([
  [1, { points: 10, provisionalBonus: 0, minutes: 90, status: "done" }],
  [2, { points: 6, provisionalBonus: 0, minutes: 90, status: "done" }],
  [3, { points: 2, provisionalBonus: 0, minutes: 90, status: "done" }],
]);

// Both rivals captain player 1; one rival also starts player 2. You start
// player 1 (not as captain) and captain player 3.
const rivals = [team([1, 2], [2, 1]), team([1, 2])];
const mine = team([1, 1], [3, 2]);
const lines = leagueOwnership(rivals, mine, players, 10);
const byPlayer = new Map(lines.map((line) => [line.element, line]));

check("captained by every rival means 200% EO", byPlayer.get(1)?.eo === 2);
check("you own him once, so net is -1", byPlayer.get(1)?.net === -1);
check("his 10 points cost you 10 against the average rival", byPlayer.get(1)?.swing === -10);
check("half the rivals start player 2", byPlayer.get(2)?.eo === 0.5 && byPlayer.get(2)?.mine === 0);
check("your differential captain gains you double", byPlayer.get(3)?.net === 2 && byPlayer.get(3)?.swing === 4);
check("biggest exposure first (player 3, net +2)", lines[0].element === 3);
check("a player everyone owns equally is left out", leagueOwnership([team([5, 1])], team([5, 1]), players, 10).length === 0);
check("no rivals means no lines", leagueOwnership([], mine, players, 10).length === 0);
check("the list stops at the number asked for", leagueOwnership(rivals, mine, players, 2).length === 2);
