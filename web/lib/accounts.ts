// Server-side helpers for member accounts: the Supabase client with the
// server key, reading a member's row, setting the sign-in cookie and
// starting a sync. Server only, since the server key must never reach the
// browser.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionValue, sessionCookieOptions, type Role } from "./session";

/** One row of the members table, as the site uses it. */
export interface Member {
  userId: string;
  teamId: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  emails: boolean;
}

// The user id given to the owner's session when Supabase isn't set up
// (sign-in with SITE_PASSWORD on a local copy of the site).
export const LOCAL_OWNER_ID = "local-owner";

/** True when Supabase is set up, so people sign in with member accounts rather than SITE_PASSWORD. */
export function accountsEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** A Supabase client with the server key, or null when SUPABASE_URL or the key isn't set. */
export function serverDatabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

/** Clement's team id from FPL_TEAM_ID, or null when it isn't set. */
export function ownerTeamId(): number | null {
  const teamId = Number(process.env.FPL_TEAM_ID);
  return Number.isInteger(teamId) && teamId > 0 ? teamId : null;
}

// A database row turned into a Member.
function toMember(row: Record<string, unknown>): Member {
  return {
    userId: row.user_id as string,
    teamId: row.team_id as number,
    name: row.name as string,
    email: row.email as string,
    role: row.role as Role,
    active: row.active as boolean,
    emails: row.emails as boolean,
  };
}

/** The member row for a Supabase Auth user, or null if there is none. Throws when the read fails. */
export async function memberByUserId(db: SupabaseClient, userId: string): Promise<Member | null> {
  const { data, error } = await db.from("members").select("user_id, team_id, name, email, role, active, emails").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Couldn't read the member's account: ${error.message}`);
  return data ? toMember(data) : null;
}

/** Signs the member in on this response: sets a fresh sign-in cookie. */
export async function setSessionCookie(response: NextResponse, member: { userId: string; teamId: number; role: Role }): Promise<NextResponse> {
  response.cookies.set(SESSION_COOKIE, await createSessionValue(member), sessionCookieOptions());
  return response;
}

/**
 * Asks Supabase to start a sync now: every team for the owner (as before
 * member accounts), only their own team for a member. Returns a message
 * when it couldn't be started; the failure is logged, never hidden.
 */
export async function startTeamSync(db: SupabaseClient, team: { teamId: number; role: Role }): Promise<string | null> {
  const args = team.role === "owner" ? { full_refresh: false } : { full_refresh: false, team_id: team.teamId };
  const { error } = await db.rpc("start_sync", args);
  if (!error) return null;
  console.error(`Couldn't start a sync for team ${team.teamId}:`, error.message);
  return "A sync couldn't be started, so your data updates at the next timed sync.";
}
