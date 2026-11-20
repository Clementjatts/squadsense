// GET /api/players/123 returns one player's detail entry for the panel.
// Runs on the server, so the Supabase key never reaches the browser.

import { NextResponse } from "next/server";
import { getPlayerDetail } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Player id must be a positive whole number" }, { status: 400 });
  }
  const detail = await getPlayerDetail(playerId);
  if (!detail) {
    return NextResponse.json({ error: `No details for player ${playerId}. Run the sync job to refresh.` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
