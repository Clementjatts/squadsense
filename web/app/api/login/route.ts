// POST /api/login checks the sign-in form and, if it's right, sets the
// sign-in cookie and sends you on to where you were going.
//
// With Supabase set up, members sign in with their email and password
// (Supabase Auth checks it), and their members row must be active.
// Without Supabase (a local copy of the site), the owner signs in with
// SITE_PASSWORD, for team FPL_TEAM_ID, as before member accounts.
// A wrong password waits a second before answering, to slow down guessing.

import { NextResponse } from "next/server";
import { LOCAL_OWNER_ID, accountsEnabled, memberByUserId, ownerTeamId, serverDatabase, setSessionCookie } from "@/lib/accounts";
import { cleanEmail, safeNextPath } from "@/lib/accountRules";
import { secretsMatch, sessionSecretConfigured, type Role } from "@/lib/session";

const WRONG_PASSWORD_DELAY_MS = 1000;

type SignInResult = { member: { userId: string; teamId: number; role: Role } } | { error: "wrong" | "inactive" | "setup" | "failed" };

// Checks an email and password with Supabase Auth, then reads the member's row.
// The password check runs on a client of its own: afterwards that client
// holds the member's session, and table reads need the server key instead.
async function signInMember(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await serverDatabase()!.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "wrong" };
  try {
    const member = await memberByUserId(serverDatabase()!, data.user.id);
    if (!member) return { error: "wrong" };
    return member.active ? { member } : { error: "inactive" };
  } catch (readError) {
    console.error((readError as Error).message);
    return { error: "failed" };
  }
}

// The local copy's owner sign-in: SITE_PASSWORD, for team FPL_TEAM_ID.
async function signInOwnerLocally(password: string): Promise<SignInResult> {
  const teamId = ownerTeamId();
  if (!process.env.SITE_PASSWORD || !teamId) return { error: "setup" };
  return (await secretsMatch(password, process.env.SITE_PASSWORD))
    ? { member: { userId: LOCAL_OWNER_ID, teamId, role: "owner" } }
    : { error: "wrong" };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const next = safeNextPath(form.get("next"));
  const password = String(form.get("password") ?? "");
  if (!sessionSecretConfigured()) return NextResponse.redirect(new URL("/login?error=setup", request.url), 303);

  const result = accountsEnabled() ? await signInMember(cleanEmail(form.get("email")), password) : await signInOwnerLocally(password);
  if ("error" in result) {
    if (result.error === "wrong") await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return NextResponse.redirect(new URL(`/login?error=${result.error}&next=${encodeURIComponent(next)}`, request.url), 303);
  }
  return setSessionCookie(NextResponse.redirect(new URL(next, request.url), 303), result.member);
}
