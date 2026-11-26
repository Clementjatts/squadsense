// Checks lineup editing in lib/planning.ts and saved drafts in lib/drafts.ts
// with the demo squad: swapping players the way FPL allows, moving
// armbands, the plan replay using your lineup (carried through transfers)
// instead of the best eleven, and fitting a saved draft to today's weeks.
// Run with: npm test

import { readFileSync } from "node:fs";
import { cleanDraftName, draftForSnapshot, isEmptyDraft } from "../lib/drafts.ts";
import { bestLineup, carryChoiceThroughMoves, setArmband, simulatePlan, swapInLineup, type LineupChoice } from "../lib/planning.ts";
import type { Snapshot } from "../lib/types.ts";

const snapshot: Snapshot = JSON.parse(readFileSync(new URL("../data/sample-snapshot.json", import.meta.url), "utf8"));
const { players } = snapshot;
const week = snapshot.weeks[0];

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};
// The swap or armband result as a lineup, or null when it was refused with a reason.
const asLineup = (result: LineupChoice | string) => (typeof result === "string" ? null : result);
const position = (id: number) => players[String(id)].position;

const best = bestLineup(snapshot.squad, players, week);
const start: LineupChoice = { starters: best.starters, bench: best.bench, captain: best.captain, viceCaptain: best.viceCaptain };
const startingKeeper = start.starters.find((id) => position(id) === "GK")!;
const backupKeeper = start.bench[0];
const benchOutfield = start.bench.slice(1);
const outfieldStarter = start.starters.find((id) => position(id) === position(benchOutfield[0]) && id !== start.captain && id !== start.viceCaptain)!;

check("demo bench starts with the backup keeper", position(backupKeeper) === "GK");

const keepers = asLineup(swapInLineup(start, startingKeeper, backupKeeper, players, week));
check("keepers swap with each other", keepers !== null && keepers.starters.includes(backupKeeper) && keepers.bench[0] === startingKeeper);
check("a keeper can't swap with an outfield player", typeof swapInLineup(start, startingKeeper, benchOutfield[0], players, week) === "string");

const sameRole = asLineup(swapInLineup(start, outfieldStarter, benchOutfield[0], players, week));
check("a starter and a bench player of the same position change places",
  sameRole !== null && sameRole.starters.includes(benchOutfield[0]) && sameRole.bench.includes(outfieldStarter));

const reordered = asLineup(swapInLineup(start, benchOutfield[0], benchOutfield[1], players, week));
check("two bench players change bench order", reordered !== null && reordered.bench[1] === benchOutfield[1] && reordered.bench[2] === benchOutfield[0]);
check("the backup keeper stays first on the bench", typeof swapInLineup(start, backupKeeper, benchOutfield[0], players, week) === "string");
check("two starters can't swap", typeof swapInLineup(start, start.starters[1], start.starters[2], players, week) === "string");

// Benching a whole position below its minimum is refused: take a 3-defender
// eleven and try to bring a defender off for a forward or midfielder.
const defenders = start.starters.filter((id) => position(id) === "DEF");
const otherBench = benchOutfield.find((id) => position(id) !== "DEF");
if (defenders.length === 3 && otherBench !== undefined) {
  check("the formation must stay legal", typeof swapInLineup(start, defenders[0], otherBench, players, week) === "string");
}

const captainSent = start.bench.find((id) => position(id) === position(start.captain) && position(id) !== "GK");
if (captainSent !== undefined) {
  const handed = asLineup(swapInLineup(start, start.captain, captainSent, players, week));
  check("benching the captain hands the armband to the vice", handed !== null && handed.captain === start.viceCaptain && handed.viceCaptain !== handed.captain && handed.starters.includes(handed.viceCaptain));
}

const swapped = asLineup(setArmband(start, start.viceCaptain, "captain"));
check("making the vice captain swaps the two armbands", swapped !== null && swapped.captain === start.viceCaptain && swapped.viceCaptain === start.captain);
check("a bench player can't wear an armband", typeof setArmband(start, benchOutfield[0], "vice") === "string");

// The plan replay uses your lineup, scored the same way as the best eleven.
const chosen = sameRole!;
const [withChoice] = simulatePlan(snapshot, [], {}, {}, {}, { [week]: chosen });
check("the plan plays your lineup", withChoice.lineupChosen && withChoice.starters.join() === chosen.starters.join());
const [withBest] = simulatePlan(snapshot, []);
check("your lineup can't score more than the best eleven", withChoice.expectedPoints <= withBest.expectedPoints + 1e-9);
check("without a choice the best eleven plays", !withBest.lineupChosen);

// A planned transfer hands the sold player's slot to the one bought.
const sold = chosen.starters.find((id) => id !== chosen.captain && id !== chosen.viceCaptain && position(id) !== "GK")!;
const bought = Object.values(players).find((player) => player.position === position(sold) && !snapshot.squad.includes(player.id))!;
const carried = carryChoiceThroughMoves(chosen, [{ week, outId: sold, inId: bought.id }]);
check("the player bought takes the sold player's slot", carried.starters.includes(bought.id) && !carried.starters.includes(sold));
const [afterMove] = simulatePlan(snapshot, [{ week, outId: sold, inId: bought.id }], {}, {}, {}, { [week]: chosen });
check("your lineup survives a planned transfer", afterMove.lineupChosen && afterMove.starters.includes(bought.id));

const broken: LineupChoice = { ...chosen, bench: chosen.bench.slice(0, 3) };
const [fallback] = simulatePlan(snapshot, [], {}, {}, {}, { [week]: broken });
check("a lineup that no longer fits falls back to the best eleven, with a note", !fallback.lineupChosen && fallback.problems.some((problem) => problem.includes("lineup")));

// Saved drafts are fitted to today's snapshot: weeks that have passed and
// players the snapshot doesn't know are dropped.
const pastWeek = week - 1;
const fitted = draftForSnapshot({
  moves: [{ week, outId: sold, inId: bought.id }, { week: pastWeek, outId: sold, inId: bought.id }, { week, outId: sold, inId: 999999 }],
  chips: { [week]: "bboost", [pastWeek]: "3xc" },
  captains: { [pastWeek]: chosen.captain },
  lineups: { [week]: chosen },
}, snapshot);
check("a saved draft keeps this week's move", fitted.moves.length === 1 && fitted.moves[0].week === week);
check("a saved draft drops past weeks' chips and captains", fitted.chips[pastWeek] === undefined && fitted.chips[week] === "bboost" && fitted.captains[pastWeek] === undefined);
check("a saved draft keeps its lineups", fitted.lineups[week]?.captain === chosen.captain);
check("an empty draft is recognized", isEmptyDraft(draftForSnapshot({}, snapshot)) && !isEmptyDraft(fitted));
check("draft names are trimmed and shortened", cleanDraftName("   Roll   GW12   ") === "Roll GW12" && cleanDraftName("x".repeat(50)).length === 30 && cleanDraftName("   ") === "");

// A move marked "Done on FPL" is in the squad once the sync has run, so a saved draft drops it.
{
  const out = snapshot.squad[0];
  const into = Object.values(players).find((candidate) => candidate.position === position(out) && !snapshot.squad.includes(candidate.id))!.id;
  const made: Snapshot = { ...snapshot, madeMoves: [{ gameweek: week, out, in: into, priceIn: players[String(into)].price }] };
  const kept = { week: snapshot.weeks[1], outId: out, inId: into };
  const restored = draftForSnapshot({ moves: [{ week, outId: out, inId: into }, kept] }, made);
  check("a draft drops a move already made on FPL, and keeps the same move in a later week", restored.moves.length === 1 && restored.moves[0] === kept);
}
