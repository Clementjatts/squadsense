// /api/session/recheck?next=/plan: the proxy sends a request here once its
// sign-in cookie is over a day old. This reads the member's row once: if
// the account is still active it issues a fresh cookie (with the team and
// role from the row, so a role change takes effect) and carries on to
// `next`; if the account was switched off or removed, it clears the
// cookie and sends the person to /login. Every method is handled the same
// way, since an API call (POST, PUT, DELETE) can arrive here too.

import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_OWNER_ID, memberByUserId, serverDatabase, setSessionCookie } from "@/lib/accounts";
import { safeNextPath } from "@/lib/accountRules";
import { SESSION_COOKIE, readSession, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

// Clears the cookie: pages go to /login, API calls get a 401.
function signedOut(request: Request, next: string): NextResponse {
  const response = next.startsWith("/api/")
    ? NextResponse.json({ error: "Your account is no longer active. Sign in again." }, { status: 401 })
    : NextResponse.redirect(new URL("/login?error=inactive", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

// The fresh cookie's contents, or null when the account should be signed out.
// Throws when the database can't be read.
async function confirmedSession(session: Session): Promise<Omit<Session, "issuedAt"> | null> {
  const db = serverDatabase();
  // Without Supabase, only the SITE_PASSWORD owner session exists: renew it as it is.
  if (!db) return session.userId === LOCAL_OWNER_ID ? session : null;
  // The SITE_PASSWORD session isn't valid once Supabase accounts are set up.
  if (session.userId === LOCAL_OWNER_ID) return null;
  const member = await memberByUserId(db, session.userId);
  return member?.active ? { userId: member.userId, teamId: member.teamId, role: member.role } : null;
}

// Re-checks the account, then renews the cookie and carries on, or signs the person out.
async function recheck(request: NextRequest): Promise<NextResponse> {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return signedOut(request, next);
  // 307 keeps the method and body of the original request.
  const carryOn = NextResponse.redirect(new URL(next, request.url), 307);
  try {
    const confirmed = await confirmedSession(session);
    return confirmed ? setSessionCookie(carryOn, confirmed) : signedOut(request, next);
  } catch (error) {
    // Don't lock people out when the database is down. The old cookie is
    // renewed as it is (keeping it would send every request straight back
    // here), so the check runs again in a day.
    console.error("Couldn't re-check the sign-in, so the cookie was renewed unchecked:", (error as Error).message);
    return setSessionCookie(carryOn, session);
  }
}

export { recheck as GET, recheck as POST, recheck as PUT, recheck as PATCH, recheck as DELETE };
