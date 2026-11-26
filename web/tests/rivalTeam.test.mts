// Checks lib/rivalTeam.ts: turning a rival's FPL picks into the pitch the
// team panel draws, with each player's points for that team and the
// players you own too.
// Run with: npm test

import { rivalTeam } from "../lib/rivalTeam.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

// Players 1-15: 1 and 12 keepers (position 1), 2-5 defenders, 6-9 midfielders, 10-11 forwards, 13-15 outfield subs.
const types: Record<number, number> = { 1: 1, 12: 1, 2: 2, 3: 2, 4: 2, 5: 2, 13: 2, 6: 3, 7: 3, 8: 3, 9: 3, 14: 3, 10: 4, 11: 4, 15: 4 };
const elements = Object.fromEntries(Object.entries(types).map(([id, type]) => [id, [Number(id) % 2 ? 1 : 2, type, `P${id}`] as [number, number, string]]));
const clubs = new Map([[1, "ARS"], [2, "MCI"]]);
const picks = [...Array(15)].map((_, slot) => ({
  element: slot + 1, position: slot + 1,
  multiplier: slot + 1 === 10 ? 2 : slot < 11 ? 1 : 0,
  is_captain: slot + 1 === 10, is_vice_captain: slot + 1 === 11,
}));
const points = new Map([[10, 8], [11, 2], [12, 6], [3, 1]]);

const team = rivalTeam(picks, points, elements, clubs, new Set([3, 10, 99]));
check("starters are positions 1 to 11", team.starters.join() === "1,2,3,4,5,6,7,8,9,10,11");
check("the bench is positions 12 to 15 in order", team.bench.join() === "12,13,14,15");
check("captain and vice come from the picks", team.captain === 10 && team.viceCaptain === 11);
check("a captain's tag shows his doubled points", team.tags.get(10)?.text === "16");
check("a starter's tag shows his points", team.tags.get(11)?.text === "2");
check("a bench player shows his own points, though they didn't count", team.tags.get(12)?.text === "6" && team.tags.get(12)?.label === "6 points on the bench");
check("a player with no points data shows 0", team.tags.get(5)?.text === "0");
check("players you own too are listed", team.shared.join() === "3,10");
check("each player gets his name, club and position", team.players["10"].name === "P10" && team.players["10"].position === "FWD" && team.players["10"].team === "MCI");
check("keepers are GK", team.players["12"].position === "GK");

const tripled = rivalTeam(picks.map((pick) => (pick.element === 10 ? { ...pick, multiplier: 3 } : pick)), points, elements, clubs, new Set());
check("a Triple Captain's tag shows his tripled points", tripled.tags.get(10)?.text === "24");
check("an unknown player still gets a name", rivalTeam(picks, points, {}, clubs, new Set()).players["1"].name === "#1");
