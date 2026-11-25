// POST /api/signup {inviteCode, teamId, name, email, password, confirm}
// creates a member account and signs the new member in.
//
// Checks, in order: sign-up is open (INVITE_CODE is set), the fields are
// fine, the invite code matches, there are fewer than MAX_MEMBERS active
// members, the FPL team exists and has no account yet, and the email has
// no account yet. Then it creates the Supabase Auth user (already
// confirmed: the invite code is the gate) and the members row. The team
// in FPL_TEAM_ID becomes the owner; everyone else is a member, and their
// first sync starts straight away.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerTeamId, serverDatabase, setSessionCookie, startTeamSync } from "@/lib/accounts";
import { MAX_MEMBERS, checkSignupFields, type SignupFields } from "@/lib/accountRules";
import { lookUpFplTeam } from "@/lib/fplEntry";
import { secretsMatch, sessionSecretConfigured, type Role } from "@/lib/session";

export const dynamic = "force-dynamic";

const WRONG_CODE_DELAY_MS = 1000;
const EMAIL_TAKEN = "That email already has an account. Sign in, or reset your password.";
const TEAM_TAKEN = "That FPL team already has an account.";

// A JSON error answer.
function refuse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Why this team or email can't sign up, or null when both are free and there's room. Throws when a read fails.
async function accountProblem(db: SupabaseClient, fields: SignupFields): Promise<string | null> {
  const active = await db.from("members").select("user_id", { count: "exact", head: true }).eq("active", true);
  if (active.error) throw new Error(`Couldn't count the members: ${active.error.message}`);
  if ((active.count ?? 0) >= MAX_MEMBERS) return `SquadSense is full (${MAX_MEMBERS} members). Ask Clement.`;
  if (await anyMemberWith(db, "team_id", fields.teamId)) return TEAM_TAKEN;
  return (await anyMemberWith(db, "email", fields.email)) ? EMAIL_TAKEN : null;
}

// True when a member (active or not) already has this value in the column. Throws when the read fails.
async function anyMemberWith(db: SupabaseClient, column: "team_id" | "email", value: number | string): Promise<boolean> {
  const { count, error } = await db.from("members").select("user_id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(`Couldn't check existing accounts: ${error.message}`);
  return (count ?? 0) > 0;
}

// Creates the Auth user and the members row. Removes the user again if the row can't be saved.
async function createMember(db: SupabaseClient, fields: SignupFields, role: Role): Promise<{ userId: string } | { error: string }> {
  const created = await db.auth.admin.createUser({ email: fields.email, password: fields.password, email_confirm: true });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? "no user returned";
    return { error: /already|registered|exists/i.test(message) ? EMAIL_TAKEN : `Couldn't create the account: ${message}` };
  }
  const userId = created.data.user.id;
  const row = { user_id: userId, team_id: fields.teamId, name: fields.name, email: fields.email, role };
  const inserted = await db.from("members").insert(row);
  if (!inserted.error) return { userId };
  const removed = await db.auth.admin.deleteUser(userId);
  if (removed.error) console.error(`Couldn't remove user ${userId} after the members row failed:`, removed.error.message);
  return { error: inserted.error.code === "23505" ? TEAM_TAKEN : `Couldn't save the account: ${inserted.error.message}` };
}

export async function POST(request: Request) {
  const db = serverDatabase();
  if (!db || !process.env.INVITE_CODE || !sessionSecretConfigured()) return refuse("Sign-up is closed.", 503);
  const checked = checkSignupFields((await request.json()) as Record<string, unknown>);
  if ("error" in checked) return refuse(checked.error, 400);
  const { fields } = checked;
  if (!(await secretsMatch(fields.inviteCode, process.env.INVITE_CODE))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_CODE_DELAY_MS));
    return refuse("That invite code isn't right.", 403);
  }
  try {
    if (!(await lookUpFplTeam(fields.teamId))) return refuse("No FPL team has that ID.", 404);
    const problem = await accountProblem(db, fields);
    if (problem) return refuse(problem, 409);
  } catch (error) {
    return refuse((error as Error).message, 502);
  }

  const role: Role = fields.teamId === ownerTeamId() ? "owner" : "member";
  const created = await createMember(db, fields, role);
  if ("error" in created) return refuse(created.error, created.error === EMAIL_TAKEN || created.error === TEAM_TAKEN ? 409 : 502);
  // The owner's team already has data; a member's first sync starts now.
  const warning = role === "member" ? await startTeamSync(db, { teamId: fields.teamId, role }) : null;
  return setSessionCookie(NextResponse.json({ created: true, warning }), { userId: created.userId, teamId: fields.teamId, role });
}
