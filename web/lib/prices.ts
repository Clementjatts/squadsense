// Small rules about FPL's price predictor, shared by the Dashboard's squad
// table and Price Watch so the two pages always agree.

// FPL's likelihood runs from -5 (falling tonight) to 5 (rising tonight).
// Only the ends of the scale mean the change is expected at the next 00:00.
export function changesTonight(likelihood: number): boolean {
  return Math.abs(likelihood) >= 5;
}
