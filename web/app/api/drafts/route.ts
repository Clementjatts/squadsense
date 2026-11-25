// /api/drafts keeps your Transfer Planner drafts in Supabase, so the Mac
// and the phone see the same ones. GET lists them, PUT {name, draft} saves
// one and DELETE {name} removes one. "current" is the draft saved as you
// plan; up to MAX_NAMED_DRAFTS more are named scenarios. Signing in is
// required, like every API route (see proxy.ts).
//
// When Supabase isn't set up (501) or the planner_drafts table hasn't been
// created yet (503), the Planner saves drafts in the browser instead.

import { NextResponse } from "next/server";
import { serverDatabase } from "@/lib/accounts";
import { currentTeam } from "@/lib/currentTeam";
import { CURRENT_DRAFT, MAX_NAMED_DRAFTS, cleanDraftName } from "@/lib/drafts";

export const dynamic = "force-dynamic";

const TABLE = "planner_drafts";
const NOT_SET_UP = "Drafts are saved in this browser: Supabase isn't set up on this copy of the site.";
const NO_TABLE = "Drafts are saved in this browser until the planner_drafts table is created in Supabase (see db/schema.sql).";

// The Supabase client with the server key and the signed-in team, whose drafts these are, or null when not set up.
async function database() {
  const db = serverDatabase();
  return db ? { db, teamId: (await currentTeam()).teamId } : null;
}

// Turns a Supabase error into a response. A missing table gets its own
// status so the Planner knows to fall back to the browser quietly.
function failure(action: string, error: { message: string; code?: string }) {
  const missingTable = error.code === "42P01" || error.code === "PGRST205" || error.message.includes(TABLE);
  return missingTable
    ? NextResponse.json({ error: NO_TABLE }, { status: 503 })
    : NextResponse.json({ error: `Couldn't ${action} drafts: ${error.message}` }, { status: 502 });
}

export async function GET() {
  const setup = await database();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { data, error } = await setup.db.from(TABLE).select("name, draft, updated_at").eq("team_id", setup.teamId).order("updated_at", { ascending: false });
  if (error) return failure("load", error);
  return NextResponse.json({ drafts: data.map((row) => ({ name: row.name, draft: row.draft, updatedAt: row.updated_at })) });
}

export async function PUT(request: Request) {
  const setup = await database();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const body = (await request.json()) as { name?: string; draft?: unknown };
  const name = cleanDraftName(body.name ?? "");
  if (!name || !body.draft) return NextResponse.json({ error: "A draft needs a name and its plan." }, { status: 400 });

  // A new named scenario only fits while there are fewer than MAX_NAMED_DRAFTS.
  if (name !== CURRENT_DRAFT) {
    const { data, error } = await setup.db.from(TABLE).select("name").eq("team_id", setup.teamId).neq("name", CURRENT_DRAFT);
    if (error) return failure("check", error);
    const others = data.filter((row) => row.name !== name);
    if (others.length >= MAX_NAMED_DRAFTS) {
      return NextResponse.json({ error: `You can keep ${MAX_NAMED_DRAFTS} scenarios. Delete one first.` }, { status: 409 });
    }
  }
  const { error } = await setup.db.from(TABLE).upsert({ team_id: setup.teamId, name, draft: body.draft, updated_at: new Date().toISOString() });
  if (error) return failure("save", error);
  return NextResponse.json({ saved: name });
}

export async function DELETE(request: Request) {
  const setup = await database();
  if (!setup) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const name = cleanDraftName(((await request.json()) as { name?: string }).name ?? "");
  if (!name) return NextResponse.json({ error: "No draft name sent." }, { status: 400 });
  const { error } = await setup.db.from(TABLE).delete().eq("team_id", setup.teamId).eq("name", name);
  if (error) return failure("delete", error);
  return NextResponse.json({ removed: name });
}
