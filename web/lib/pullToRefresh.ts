// The maths for pull to refresh (PullToRefresh.tsx). The spinner follows
// your finger at half speed, so the pull feels stretchy, and stops at
// MAX_PULL. Letting go once it has moved REFRESH_AT pixels reloads the page.

/** Pixels the spinner must travel before letting go reloads. */
export const REFRESH_AT = 70;

/** The furthest the spinner travels, however far you pull. */
export const MAX_PULL = 110;

const RESISTANCE = 0.5; // the spinner moves half as far as your finger

/** How far the spinner sits below the top for a finger `dragged` pixels down (negative = up). */
export function pullDistance(dragged: number): number {
  return Math.min(MAX_PULL, Math.max(0, dragged * RESISTANCE));
}

/** True when letting go at this spinner distance should reload the page. */
export function shouldRefresh(distance: number): boolean {
  return distance >= REFRESH_AT;
}
