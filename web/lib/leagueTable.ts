// Splitting a league table into pages of LEAGUE_PAGE_SIZE teams, so big
// leagues don't scroll on and on. Pure functions, shared by the Leagues
// page and its tests. Pages are counted from 0.

export const LEAGUE_PAGE_SIZE = 20;

/** How many pages a table of `rowCount` teams needs (at least 1, so an empty table still has a page). */
export function pageCount(rowCount: number, size = LEAGUE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rowCount / size));
}

/** The rows on one page, with each row's place in the whole table (for the "..." gap check). */
export function pageRows<T>(rows: T[], page: number, size = LEAGUE_PAGE_SIZE): { row: T; index: number }[] {
  const start = page * size;
  return rows.slice(start, start + size).map((row, offset) => ({ row, index: start + offset }));
}

/** The page holding team `entry`, or the first page when the team isn't in the table. */
export function pageWithEntry(rows: { entry: number }[], entry: number, size = LEAGUE_PAGE_SIZE): number {
  const index = rows.findIndex((row) => row.entry === entry);
  return index < 0 ? 0 : Math.floor(index / size);
}
