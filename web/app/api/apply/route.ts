// /api/apply: send a planned gameweek to your real FPL team.
//
// GET says whether applying is possible here. POST with action "preview"
// signs in, reads your team from FPL and returns exactly what would
// change, with any problems. POST with action "apply" does the same
// checks again and then makes the changes, but only if there are no
// problems and `confirm` is the word APPLY. Transfers can't be undone.
//
// This only works for the owner, from this Mac (localhost), and only when
// FPL_EMAIL and FPL_PASSWORD are in web/.env.local, so the hosted site and
// members can never do it.

import { NextResponse } from "next/server";
import { ownerTeamId } from "@/lib/accounts";
import { currentTeam, type CurrentTeam } from "@/lib/currentTeam";
import { previewApply, type ApplyRequest, type PlayerFacts } from "@/lib/applyPlan";
import { FplAccountError, fplCredentials, getMyTeam, postLineup, postTransfers, signIn } from "@/lib/fplAccount";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CONFIRM_WORD = "APPLY";

interface Bootstrap {
  elements: { id: number; web_name: string; element_type: number; now_cost: number }[];
  events: { id: number; is_next: boolean }[];
}

// Why applying isn't possible here, or null if it is. Only the owner can
// apply, and only to his own team (the signed-in team, which must also be
// FPL_TEAM_ID, the team the FPL sign-in in web/.env.local belongs to).
function unavailableReason(request: Request, team: CurrentTeam): string | null {
  if (team.role !== "owner") return "Applying to FPL is only for the site's owner.";
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) return "Applying to FPL only works on the copy of the site running on your Mac.";
  if (!fplCredentials()) return "Add FPL_EMAIL and FPL_PASSWORD to web/.env.local to apply plans to FPL.";
  if (ownerTeamId() !== team.teamId) return "FPL_TEAM_ID in web/.env.local must be the signed-in team.";
  return null;
}

// Whether applying is possible here. Members get no reason, so the Planner shows them nothing at all.
export async function GET(request: Request) {
  const team = await currentTeam();
  const reason = unavailableReason(request, team);
  return NextResponse.json({ available: reason === null, reason: team.role === "owner" ? reason : null, confirmWord: CONFIRM_WORD });
}

export async function POST(request: Request) {
  const team = await currentTeam();
  const reason = unavailableReason(request, team);
  if (reason) return NextResponse.json({ error: reason }, { status: 403 });
  const body = (await request.json()) as { action: "preview" | "apply"; plan: ApplyRequest; confirm?: string };
  const teamId = team.teamId;
  const credentials = fplCredentials()!;

  try {
    const bootstrapResponse = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/", { cache: "no-store" });
    if (!bootstrapResponse.ok) throw new FplAccountError(`FPL's player list didn't load (HTTP ${bootstrapResponse.status})`);
    const bootstrap = (await bootstrapResponse.json()) as Bootstrap;
    const nextWeek = bootstrap.events.find((event) => event.is_next)?.id;
    const players = new Map<number, PlayerFacts>(
      bootstrap.elements.map((element) => [element.id, { id: element.id, name: element.web_name, position: element.element_type, nowCost: element.now_cost }]),
    );

    const headers = await signIn(credentials.email, credentials.password);
    const preview = previewApply(body.plan, await getMyTeam(headers, teamId), teamId, players);
    if (body.plan.gameweek !== nextWeek) preview.problems.push(`Only the next gameweek (GW${nextWeek}) can be applied.`);
    if (body.action === "preview") return NextResponse.json(preview);

    if (preview.problems.length > 0) return NextResponse.json({ error: "Not applied: fix the problems first.", preview }, { status: 409 });
    if (body.confirm !== CONFIRM_WORD) return NextResponse.json({ error: `Type ${CONFIRM_WORD} to confirm.` }, { status: 400 });

    const done: string[] = [];
    if (preview.transferPayload) {
      await postTransfers(headers, preview.transferPayload);
      done.push("transfers");
    }
    try {
      await postLineup(headers, teamId, preview.lineupPayload);
      done.push("lineup");
    } catch (error) {
      // Transfers can't be rolled back, so say exactly what did and didn't happen.
      return NextResponse.json({ error: `Transfers were made, but the lineup wasn't set: ${(error as Error).message}. Set it on the FPL site.`, done }, { status: 502 });
    }
    return NextResponse.json({ done, preview });
  } catch (error) {
    const message = error instanceof FplAccountError ? error.message : `Unexpected problem: ${(error as Error).message}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
