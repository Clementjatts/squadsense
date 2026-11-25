// /api/made-moves: mark one of the coming week's planned moves as made on
// the FPL site (POST {gameweek, out, in}) or undo that (DELETE {gameweek,
// out}). Signed in only, like every API route (proxy.ts), and always for
// the signed-in team. Only moves in the plan's first week can be marked,
// at the price the snapshot shows. After a change it asks Supabase to
// start a sync (start_sync: every team for the owner, only their own team
// for a member), so the plan catches up in about 5 minutes rather than at
// the next timed run.

import { NextResponse } from "next/server";
import { startTeamSync } from "@/lib/accounts";
import { madeMovesDatabase } from "@/lib/madeMoves";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const NOT_SET_UP = "Marking moves needs Supabase, which isn't set up on this copy of the site.";

// The warning to show after saving, or null when the sync started.
async function syncWarning(setup: NonNullable<Awaited<ReturnType<typeof madeMovesDatabase>>>): Promise<string | null> {
  const warning = await startTeamSync(setup.db, setup);
  return warning && `Saved. ${warning}`;
}

export async function POST(request: Request) {
  const setup = await madeMovesDatabase();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const body = (await request.json()) as { gameweek?: number; out?: number; in?: number };
  const { snapshot } = await getSnapshot();
  const week = snapshot.solverPlan?.weeks[0];
  const move = week?.moves.find((candidate) => candidate.out === body.out && candidate.in === body.in);
  if (!week || !move || body.gameweek !== week.gameweek) {
    return NextResponse.json({ error: "That move isn't in this week's plan any more. Reload the page." }, { status: 400 });
  }
  const priceIn = snapshot.players[String(move.in)]?.price;
  if (priceIn === undefined) return NextResponse.json({ error: "The new player's price is missing. Reload the page." }, { status: 400 });

  const { error } = await setup.db.from("made_moves").upsert({
    team_id: setup.teamId, gameweek: week.gameweek, player_out: move.out, player_in: move.in, price_in: priceIn, made_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: `Couldn't save the move: ${error.message}` }, { status: 502 });
  return NextResponse.json({ marked: true, warning: await syncWarning(setup) });
}

export async function DELETE(request: Request) {
  const setup = await madeMovesDatabase();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const body = (await request.json()) as { gameweek?: number; out?: number };
  if (!body.gameweek || !body.out) return NextResponse.json({ error: "No move was sent." }, { status: 400 });
  const { error } = await setup.db.from("made_moves").delete().eq("team_id", setup.teamId).eq("gameweek", body.gameweek).eq("player_out", body.out);
  if (error) return NextResponse.json({ error: `Couldn't undo the move: ${error.message}` }, { status: 502 });
  return NextResponse.json({ marked: false, warning: await syncWarning(setup) });
}
