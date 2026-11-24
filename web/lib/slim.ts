// Pages that hand the snapshot to a component running in the browser send
// all of it to the phone. These helpers drop the parts such a page never
// shows (Price Watch rows, the Fixture Ticker, other leagues), which were
// most of the 600 KB the Planner and Leagues pages sent.

import type { League, Snapshot } from "./types";

/** The snapshot without the parts that only the Prices, Fixtures, Leagues, Review and Dashboard pages show. */
export function forOnePage(snapshot: Snapshot, keepLeagues = false): Snapshot {
  return {
    ...snapshot,
    priceWatch: { ...snapshot.priceWatch, players: [] },
    fixtureTicker: { ...snapshot.fixtureTicker, teams: [] },
    leagues: keepLeagues ? snapshot.leagues : [],
    review: null,
    changes: [],
  };
}

/** Every league's name and size for the picker, with the tables and lists of the chosen one only. */
export function withOneLeague(leagues: League[], chosenId: number | undefined): { leagues: League[]; chosen: League | undefined } {
  const chosen = leagues.find((league) => league.id === chosenId) ?? leagues[0];
  const slim = leagues.map((league) =>
    league === chosen ? league : { ...league, table: [], mySquad: [], threats: [], differentials: [], topCaptains: [] },
  );
  return { leagues: slim, chosen };
}
