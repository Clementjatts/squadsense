// Checks lib/madeMoveRules.ts: which transfers can be marked "Done on FPL".
// Any legal transfer for the coming week can be marked, not only the plan's.
// Marks saved since the last sync count too, so two marks in a row work.
// Run with: npm test

import { readFileSync } from "node:fs";
import { madeMoveProblem } from "../lib/madeMoveRules.ts";
import type { Player, Snapshot } from "../lib/types.ts";

const snapshot: Snapshot = JSON.parse(readFileSync(new URL("../data/sample-snapshot.json", import.meta.url), "utf8"));
const { players, squad } = snapshot;

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};
const player = (id: number) => players[String(id)];
const notOwned = (test: (candidate: Player) => boolean) =>
  Object.values(players).find((candidate) => !squad.includes(candidate.id) && test(candidate))!;
const clubCount = (club: string) => squad.filter((id) => player(id).team === club).length;

// Mykolenko (EVE defender, sells for 4.4) is the player out in most checks.
const mykolenko = squad.find((id) => player(id).name === "Mykolenko")!;
const budget = snapshot.bank + player(mykolenko).sellingPrice!;
const fullClub = squad.map((id) => player(id).team).find((club) => clubCount(club) === 3)!;
const affordable = notOwned((c) => c.position === "DEF" && c.price <= budget && clubCount(c.team) < 3);
const tooDear = notOwned((c) => c.position === "DEF" && c.price > budget && clubCount(c.team) < 3);
const fourthFromClub = notOwned((c) => c.position === "DEF" && c.team === fullClub && c.price <= budget);
const midfielder = notOwned((c) => c.position === "MID" && c.price <= budget && clubCount(c.team) < 3);

check("a legal transfer can be marked", madeMoveProblem(snapshot, [], mykolenko, affordable.id) === null);
check("the player out must be in your squad", madeMoveProblem(snapshot, [], affordable.id, tooDear.id) === `${affordable.name} isn't in your squad.`);
check("the player in can't already be in your squad", madeMoveProblem(snapshot, [], mykolenko, squad[0]) === `${player(squad[0]).name} is already in your squad.`);
check("both players play the same position", madeMoveProblem(snapshot, [], mykolenko, midfielder.id) === `${midfielder.name} isn't a defender like ${player(mykolenko).name}.`);
check("no more than 3 from one club", madeMoveProblem(snapshot, [], mykolenko, fourthFromClub.id) === `You'd have 4 ${fullClub} players; FPL allows 3.`);
check("the bank must cover the new player", madeMoveProblem(snapshot, [], mykolenko, tooDear.id)?.startsWith(`${tooDear.name} costs £`) === true);
check("an unknown player is refused", madeMoveProblem(snapshot, [], mykolenko, 999999) === "That player isn't in the latest data. Reload the page.");

// A mark saved since the last sync: Mykolenko already went out for `affordable`.
const pending = [{ out: mykolenko, in: affordable.id, priceIn: affordable.price }];
check("a marked player can't go out twice", madeMoveProblem(snapshot, pending, mykolenko, tooDear.id) === `${player(mykolenko).name} isn't in your squad.`);
check("the player bought in an earlier mark can be sold", madeMoveProblem(snapshot, pending, affordable.id, mykolenko) === null);
check("an earlier mark's money counts", (() => {
  const spare = snapshot.bank + player(mykolenko).sellingPrice! - affordable.price; // bank after the first mark
  const second = squad.find((id) => player(id).position === "DEF" && id !== mykolenko)!;
  const target = notOwned((c) => c.position === "DEF" && c.id !== affordable.id && clubCount(c.team) < 3
    && c.price > snapshot.bank + player(second).sellingPrice! && c.price <= spare + player(second).sellingPrice!);
  return !target || madeMoveProblem(snapshot, pending, second, target.id) === null;
})());
check("marks the snapshot already includes aren't applied again", (() => {
  // After a sync the squad already has the move and the snapshot lists it; the same mark is still in the table.
  const synced: Snapshot = {
    ...snapshot,
    squad: squad.map((id) => (id === mykolenko ? affordable.id : id)),
    bank: budget - affordable.price,
    players: { ...players, [String(affordable.id)]: { ...affordable, sellingPrice: affordable.price } },
    madeMoves: [{ gameweek: snapshot.weeks[0], ...pending[0] }],
  };
  return madeMoveProblem(synced, pending, affordable.id, mykolenko) === null;
})());
