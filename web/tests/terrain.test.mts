// Checks lib/terrain.ts, which turns the Fixture Ticker into the columns of
// the 3D terrain: one column per club and gameweek, in the same order as the
// table, tall for hard fixtures and low for easy ones.
// Run with: npm test

import { terrainColumns } from "../lib/terrain.ts";
import type { FixtureTicker } from "../lib/types.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

const match = (opponent: string, isHome: boolean, attackDifficulty: number, defenceDifficulty: number) =>
  ({ opponent, isHome, attackDifficulty, defenceDifficulty });

const ticker: FixtureTicker = {
  weeks: [14, 15, 16],
  windows: [2, 3],
  teams: [
    { id: 1, name: "ARS", matches: { "14": [match("CHE", true, 4, 2)], "15": [], "16": [match("LIV", false, 5, 5), match("BUR", true, 1, 1)] },
      scores: { attack: { "2": 1.0, "3": 2.0 }, defence: { "2": 0.9, "3": 1.0 } } },
    { id: 2, name: "BUR", matches: { "14": [match("MCI", false, 5, 5)], "15": [match("ARS", false, 4, 3)], "16": [match("ARS", false, 5, 5)] },
      scores: { attack: { "2": 3.0, "3": 0.5 }, defence: { "2": 0.2, "3": 0.1 } } },
  ],
};

const attack3 = terrainColumns(ticker, "attack", 3, [2]);
check("clubs come in the table's order, best score first", attack3.teams.map((team) => team.name).join() === "ARS,BUR");
check("one column per club and shown gameweek", attack3.columns.length === 6);
check("a shorter window shows fewer gameweeks", terrainColumns(ticker, "attack", 2, []).columns.length === 4);
check("a shorter window re-ranks by its own score", terrainColumns(ticker, "attack", 2, []).teams[0].name === "BUR");

const ars14 = attack3.columns.find((column) => column.teamId === 1 && column.gameweek === 14)!;
check("height is the difficulty for the chosen mode", ars14.height === 4 && terrainColumns(ticker, "defence", 3, []).columns.find((c) => c.teamId === 1 && c.gameweek === 14)!.height === 2);
check("the label names the match, venue, week and difficulty", ars14.label === "ARS v CHE (H), GW14: Hard");

const ars15 = attack3.columns.find((column) => column.teamId === 1 && column.gameweek === 15)!;
check("a blank week is flat and says so", ars15.height === 0 && ars15.level === 0 && ars15.label === "ARS, GW15: no match");

const ars16 = attack3.columns.find((column) => column.teamId === 1 && column.gameweek === 16)!;
check("a double adds both matches' difficulty", ars16.height === 6);
check("a double is colored by its average difficulty", ars16.level === 3);
check("a double's label lists both matches", ars16.label === "ARS v LIV (A) Hardest, BUR (H) Easiest, GW16");

check("clubs you own are marked", attack3.columns.filter((column) => column.mine).every((column) => column.teamId === 2)
  && attack3.columns.some((column) => column.mine));
check("row and column place each block on the grid", ars16.row === 0 && ars16.col === 2);
