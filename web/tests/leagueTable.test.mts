// Checks for lib/leagueTable.ts: how many pages a league table needs,
// which rows each page shows, and which page holds your team.
// Run with: npm test

import { pageCount, pageRows, pageWithEntry } from "../lib/leagueTable.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

const table = Array.from({ length: 45 }, (_, index) => ({ entry: 100 + index }));

check("45 teams need 3 pages of 20", pageCount(45) === 3);
check("an empty table still has one page", pageCount(0) === 1);
check("exactly 40 teams fill 2 pages", pageCount(40) === 2);
check("page 2 shows the last 5 teams", pageRows(table, 2).length === 5 && pageRows(table, 2)[0].row.entry === 140);
check("rows keep their place in the whole table", pageRows(table, 1)[0].index === 20);
check("team 125 is on page 2 (index 1)", pageWithEntry(table, 125) === 1);
check("a team not in the table opens the first page", pageWithEntry(table, 9999) === 0);
