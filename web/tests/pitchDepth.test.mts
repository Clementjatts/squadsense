// Checks lib/pitchDepth.ts: on the tilted pitch the front row (the
// goalkeeper, drawn last) is full size and rows further up the pitch are
// drawn smaller, evenly, down to 1 - DEPTH_SHRINK for the back row.
// Run with: npm test

import { DEPTH_SHRINK, rowDepthScale } from "../lib/pitchDepth.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

check("the front row is full size", rowDepthScale(3, 4) === 1);
check("the back row shrinks by DEPTH_SHRINK", close(rowDepthScale(0, 4), 1 - DEPTH_SHRINK));
check("rows in between shrink evenly", close(rowDepthScale(1, 4) - rowDepthScale(0, 4), rowDepthScale(2, 4) - rowDepthScale(1, 4)));
check("a single row is full size", rowDepthScale(0, 1) === 1);
check("the shrink stays small enough to read names", DEPTH_SHRINK > 0 && DEPTH_SHRINK <= 0.25);
