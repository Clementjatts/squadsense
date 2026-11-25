// Small rules for the watchlist's list of player ids, shared by the
// browser hook (lib/watchlist.ts) and the API route, and checked by
// tests/watchlist.test.mts.

/** Keeps whole positive numbers only, each once, in the order given. Returns null when `value` isn't a list. */
export function cleanIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const valid = value.filter((id): id is number => Number.isInteger(id) && id > 0);
  return [...new Set(valid)];
}

/** The server's list plus any ids only this browser had saved, server order first. */
export function mergeIds(server: number[], local: number[]): number[] {
  return [...new Set([...server, ...local])];
}
