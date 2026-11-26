// Checks lib/pullToRefresh.ts: how far the spinner follows your finger when
// you pull down at the top of a page, and when letting go reloads it.
// Run with: npm test

import { MAX_PULL, REFRESH_AT, pullDistance, shouldRefresh } from "../lib/pullToRefresh.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

check("no pull, no movement", pullDistance(0) === 0);
check("pushing up never moves the spinner", pullDistance(-40) === 0);
check("the spinner moves slower than the finger, so it feels stretchy", pullDistance(100) > 0 && pullDistance(100) < 100);
check("it never goes past the maximum", pullDistance(5000) === MAX_PULL);
check("further pulls move it further", pullDistance(120) > pullDistance(60));
check("letting go short of the line doesn't reload", !shouldRefresh(REFRESH_AT - 1));
check("letting go at the line reloads", shouldRefresh(REFRESH_AT));
check("the line can be reached", MAX_PULL > REFRESH_AT && pullDistance(400) >= REFRESH_AT);
