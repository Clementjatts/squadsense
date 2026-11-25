// POST /api/reset (form fields: token_hash, password, confirm) sets a new
// password from a reset link, then signs the member in. The password is
// checked first, so a typo doesn't use up the one-time link. Problems send
// you back to /reset with a short code the page turns into words.

import { NextResponse } from "next/server";
import { memberByUserId, serverDatabase, setSessionCookie } from "@/lib/accounts";
import { passwordProblemCode } from "@/lib/accountRules";
import { sessionSecretConfigured } from "@/lib/session";

export const dynamic = "force-dynamic";

type ResetResult = { member: { userId: string; teamId: number; role: "owner" | "member" } } | { error: "expired" | "inactive" | "failed" };

// Uses the one-time token, saves the new password and reads the member's row.
// The token check runs on a client of its own: afterwards that client holds
// the member's session, and the admin call and table reads need the server key.
async function resetPassword(tokenHash: string, password: string): Promise<ResetResult> {
  const verified = await serverDatabase()!.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (verified.error || !verified.data.user) return { error: "expired" };
  const db = serverDatabase()!;
  const userId = verified.data.user.id;
  const updated = await db.auth.admin.updateUserById(userId, { password });
  if (updated.error) {
    console.error("Couldn't save the new password:", updated.error.message);
    return { error: "failed" };
  }
  try {
    const member = await memberByUserId(db, userId);
    return member?.active ? { member } : { error: "inactive" };
  } catch (error) {
    console.error((error as Error).message);
    return { error: "failed" };
  }
}

// Back to the reset page with a problem code, keeping the token when it can still be used.
function backToReset(request: Request, code: string, tokenHash: string | null) {
  const page = new URL("/reset", request.url);
  if (tokenHash) page.searchParams.set("token_hash", tokenHash);
  page.searchParams.set("error", code);
  return NextResponse.redirect(page, 303);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const password = String(form.get("password") ?? "");
  if (!serverDatabase() || !sessionSecretConfigured()) return backToReset(request, "setup", null);
  if (!tokenHash) return backToReset(request, "expired", null);
  const problem = passwordProblemCode(password, String(form.get("confirm") ?? ""));
  if (problem) return backToReset(request, problem, tokenHash);

  const result = await resetPassword(tokenHash, password);
  if ("error" in result) return backToReset(request, result.error, null);
  return setSessionCookie(NextResponse.redirect(new URL("/", request.url), 303), result.member);
}
