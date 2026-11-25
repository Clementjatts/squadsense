// /api/watchlist keeps the Price Watch watchlist in Supabase, so the Mac
// and the phone see the same players and the sync can send "Watched
// player likely to rise tonight". GET returns {ids}, PUT {ids} replaces
// the whole list. Signing in is required, like every API route (proxy.ts).
//
// When Supabase isn't set up (501) or the watchlist table hasn't been
// created yet (503), the browser keeps the list in its own storage instead.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanIds } from "@/lib/watchlistIds";

export const dynamic = "force-dynamic";

const TABLE = "watchlist";
const NOT_SET_UP = "The watchlist is saved in this browser: Supabase isn't set up on this copy of the site.";
const NO_TABLE = "The watchlist is saved in this browser until the watchlist table is created in Supabase (see db/schema.sql).";

// The Supabase client with the server key and the team the list belongs to, or null when not set up.
function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const teamId = Number(process.env.FPL_TEAM_ID);
  return url && key && teamId ? { db: createClient(url, key, { auth: { persistSession: false } }), teamId } : null;
}

// Turns a Supabase error into a response. A missing table gets its own
// status so the browser knows to fall back to its own storage quietly.
function failure(action: string, error: { message: string; code?: string }) {
  const missingTable = error.code === "42P01" || error.code === "PGRST205" || error.message.includes(TABLE);
  return missingTable
    ? NextResponse.json({ error: NO_TABLE }, { status: 503 })
    : NextResponse.json({ error: `Couldn't ${action} the watchlist: ${error.message}` }, { status: 502 });
}

// The watched player ids, oldest first.
export async function GET() {
  const setup = database();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { data, error } = await setup.db.from(TABLE).select("player_id").eq("team_id", setup.teamId).order("added_at");
  if (error) return failure("load", error);
  return NextResponse.json({ ids: data.map((row) => row.player_id as number) });
}

// Replaces the whole list: removes players no longer on it, then adds the
// new ones. Players already on it keep their added_at time.
export async function PUT(request: Request) {
  const setup = database();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const ids = cleanIds(((await request.json()) as { ids?: unknown }).ids);
  if (!ids) return NextResponse.json({ error: "Send the watchlist as {ids: [player ids]}." }, { status: 400 });

  const removal = setup.db.from(TABLE).delete().eq("team_id", setup.teamId);
  const { error: removeError } = await (ids.length ? removal.not("player_id", "in", `(${ids.join(",")})`) : removal);
  if (removeError) return failure("save", removeError);
  if (ids.length) {
    const rows = ids.map((playerId) => ({ team_id: setup.teamId, player_id: playerId }));
    const { error } = await setup.db.from(TABLE).upsert(rows, { onConflict: "team_id,player_id", ignoreDuplicates: true });
    if (error) return failure("save", error);
  }
  return NextResponse.json({ ids });
}
