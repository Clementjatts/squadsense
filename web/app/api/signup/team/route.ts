// GET /api/signup/team?id=123: the FPL team's name and manager, so the
// sign-up form can show "Team: X, manager Y" before it's sent. Open without
// signing in (proxy.ts), and it only returns what FPL shows publicly.

import { NextResponse } from "next/server";
import { isTeamId } from "@/lib/accountRules";
import { lookUpFplTeam } from "@/lib/fplEntry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const teamId = Number(new URL(request.url).searchParams.get("id"));
  if (!isTeamId(teamId)) return NextResponse.json({ error: "A team ID is a whole number." }, { status: 400 });
  try {
    const team = await lookUpFplTeam(teamId);
    return team ? NextResponse.json(team) : NextResponse.json({ error: "No FPL team has that ID." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
