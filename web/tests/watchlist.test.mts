// Checks for lib/watchlistIds.ts: cleaning the ids the browser sends and
// merging a browser's saved list into the server's.
// Run with: npm test

import { cleanIds, mergeIds } from "../lib/watchlistIds.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

const same = (a: number[] | null, b: number[]) => JSON.stringify(a) === JSON.stringify(b);

check("merge keeps the server's ids and adds the browser's new ones", same(mergeIds([3, 7], [7, 12]), [3, 7, 12]));
check("merging an empty browser list changes nothing", same(mergeIds([3, 7], []), [3, 7]));
check("merging into an empty server list keeps every browser id", same(mergeIds([], [5, 2]), [5, 2]));
check("clean drops repeats, fractions, zero and text", same(cleanIds([4, 4, 2.5, 0, "9", 11]), [4, 11]));
check("clean refuses something that isn't a list", cleanIds({ ids: [1] }) === null);
check("clean accepts an empty list", same(cleanIds([]), []));
