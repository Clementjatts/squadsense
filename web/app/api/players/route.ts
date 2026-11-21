// GET /api/players returns a short entry for every player, for search
// and the comparison picker. About 700 players at a few fields each, so
// the browser asks for it once, only when search is first opened.

import { NextResponse } from "next/server";
import { getAllPlayerDetails } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const details = await getAllPlayerDetails();
  const index = Object.values(details).map((detail) => ({
    id: detail.id,
    name: detail.name,
    fullName: detail.fullName,
    team: detail.team,
    position: detail.position,
    price: detail.price,
  }));
  index.sort((a, b) => b.price - a.price);
  return NextResponse.json(index);
}
