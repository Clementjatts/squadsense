// Checks the planner's copies of the FPL rules (hits, free transfers, club
// limit, formations) against shared/rule-cases.json. The Python tests check rules.py
// against the same file, so the two copies can't drift apart.
// Run with: npm test

import { readFileSync } from "node:fs";
import { clubsOverLimit, hitPoints, isValidFormation, nextFreeTransfers } from "../lib/planning.ts";

const cases = JSON.parse(readFileSync(new URL("../../shared/rule-cases.json", import.meta.url), "utf8"));

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

for (const item of cases.hitPoints) {
  check(`hits: ${item.why}`, hitPoints(item.transfersMade, item.freeTransfers, item.chip) === item.expected);
}
for (const item of cases.nextFreeTransfers) {
  check(`free transfers: ${item.why}`, nextFreeTransfers(item.freeTransfers, item.transfersMade, item.chip) === item.expected);
}
for (const item of cases.clubsOverLimit) {
  check(`club limit: ${item.why}`, JSON.stringify(clubsOverLimit(item.clubs)) === JSON.stringify(item.expected));
}
for (const item of cases.formations) {
  check(`formation: ${item.why}`, isValidFormation(item.positions) === item.expected);
}
