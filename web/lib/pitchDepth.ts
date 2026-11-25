// Depth on the tilted pitch. The camera sits behind your goal, so the
// goalkeeper's row (the last one drawn) is nearest and full size, and each
// row further up the pitch is drawn a little smaller, which also narrows
// its spread the way a TV angle does.

/** How much smaller the back row is than the front row (0.16 = 16% smaller). */
export const DEPTH_SHRINK = 0.16;

/** The size of row `index` of `rowCount`, counting from the back (forwards) to the front (goalkeeper). */
export function rowDepthScale(index: number, rowCount: number): number {
  if (rowCount <= 1) return 1;
  const distanceFromFront = (rowCount - 1 - index) / (rowCount - 1);
  return 1 - DEPTH_SHRINK * distanceFromFront;
}
