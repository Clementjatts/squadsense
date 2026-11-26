// /api/made-moves: mark a transfer for the coming week as made on the FPL
// site (POST {gameweek, out, in}) or undo that (DELETE {gameweek, out}).
// Signed in only, like every API route (proxy.ts), and always for the
// signed-in team. Any legal transfer can be marked, not only the plan's
// (lib/madeMoveRules.ts checks it), at the price the snapshot shows. After a change it asks Supabase to
// start a sync (start_sync: every team for the owner, only their own team
// for a member), so the plan catches up in about 5 minutes rather than at
// the next timed run.

import { NextResponse } from "next/server";
import { startTeamSync } from "@/lib/accounts";
import { loadMadeMoves, madeMovesDatabase } from "@/lib/madeMoves";
import { madeMoveProblem } from "@/lib/madeMoveRules";
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
  const gameweek = snapshot.weeks[0];
  if (body.gameweek !== gameweek || !body.out || !body.in) {
    return NextResponse.json({ error: `Only transfers for GW${gameweek} can be marked. Reload the page.` }, { status: 400 });
  }
  let savedMarks;
  try {
    savedMarks = await loadMadeMoves(gameweek);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
  const problem = madeMoveProblem(snapshot, savedMarks, body.out, body.in);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { error } = await setup.db.from("made_moves").upsert({
    team_id: setup.teamId, gameweek, player_out: body.out, player_in: body.in, price_in: snapshot.players[String(body.in)].price, made_at: new Date().toISOString(),
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
