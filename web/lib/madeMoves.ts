// Moves a member marked "Done on FPL". FPL hides transfers until the
// deadline, so the sync can't see them; these marks (Supabase table
// made_moves) tell it to plan from the squad after them. Server only,
// since it uses the Supabase server key.

import "server-only";
import { serverDatabase } from "./accounts";
import { currentTeam, type CurrentTeam } from "./currentTeam";

export interface MadeMove {
  gameweek: number;
  out: number;
  in: number;
  priceIn: number; // tenths of a million, as shown when marked
}

/** The Supabase client with the server key and the signed-in team, or null when Supabase isn't set up. */
export async function madeMovesDatabase(): Promise<({ db: NonNullable<ReturnType<typeof serverDatabase>> } & CurrentTeam) | null> {
  const db = serverDatabase();
  return db ? { db, ...(await currentTeam()) } : null;
}

/** The signed-in team's marks for one gameweek. Empty when Supabase isn't set up; throws when it fails. */
export async function loadMadeMoves(gameweek: number): Promise<MadeMove[]> {
  const setup = await madeMovesDatabase();
  if (!setup) return [];
  const { data, error } = await setup.db
    .from("made_moves")
    .select("gameweek, player_out, player_in, price_in")
    .eq("team_id", setup.teamId)
    .eq("gameweek", gameweek);
  if (error) throw new Error(`Couldn't load the moves marked done: ${error.message}`);
  return data.map((row) => ({ gameweek: row.gameweek, out: row.player_out, in: row.player_in, priceIn: row.price_in }));
}

/** The marks for a page: the moves marked so far, or a message when they couldn't be loaded. */
export async function madeMovesForPage(gameweek: number): Promise<{ marked: Set<number>; error: string | null }> {
  try {
    return { marked: new Set((await loadMadeMoves(gameweek)).map((move) => move.out)), error: null };
  } catch (error) {
    console.error((error as Error).message);
    return { marked: new Set(), error: (error as Error).message };
  }
}

/** "Already made on FPL: Raya → Trafford, Saka → Palmer", or null when nothing has been made. */
export function alreadyMadeLine(moves: { out: number; in: number }[] | undefined, nameOf: (id: number) => string): string | null {
  if (!moves || moves.length === 0) return null;
  return `Already made on FPL: ${moves.map((move) => `${nameOf(move.out)} → ${nameOf(move.in)}`).join(", ")}`;
}
