// /api/me: the signed-in member's own account, for the bell menu.
// GET returns {name, emails}; PATCH {emails: boolean} turns the alert
// emails on or off. Only ever the signed-in member's own row, taken from
// the sign-in cookie. On a copy without Supabase (the SITE_PASSWORD
// sign-in) there is no account row, so GET returns nulls and PATCH says so.

import { NextResponse } from "next/server";
import { memberByUserId, serverDatabase } from "@/lib/accounts";
import { currentTeam } from "@/lib/currentTeam";

export const dynamic = "force-dynamic";

const NOT_SET_UP = "Account settings need Supabase, which isn't set up on this copy of the site.";

export async function GET() {
  const db = serverDatabase();
  if (!db) return NextResponse.json({ name: null, emails: null });
  try {
    const member = await memberByUserId(db, (await currentTeam()).userId);
    return NextResponse.json({ name: member?.name ?? null, emails: member?.emails ?? null });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const db = serverDatabase();
  if (!db) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { emails } = (await request.json()) as { emails?: unknown };
  if (typeof emails !== "boolean") return NextResponse.json({ error: "Send {emails: true} or {emails: false}." }, { status: 400 });
  const { userId } = await currentTeam();
  const { error } = await db.from("members").update({ emails }).eq("user_id", userId);
  if (error) return NextResponse.json({ error: `Couldn't save the setting: ${error.message}` }, { status: 502 });
  return NextResponse.json({ emails });
}
