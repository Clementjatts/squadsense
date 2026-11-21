// POST /api/login checks the password from the login form and, if it
// matches, sets the session cookie and sends you on to where you were going.
// A wrong password waits a second before answering, to slow down guessing.

import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, createSessionValue, loginConfigured, passwordMatches } from "@/lib/session";

const WRONG_PASSWORD_DELAY_MS = 1000;

// Only allow redirects to pages on this site, never to another address.
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  if (!loginConfigured()) {
    return NextResponse.redirect(new URL("/login?error=setup", request.url), 303);
  }
  if (!(await passwordMatches(String(form.get("password") ?? "")))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return NextResponse.redirect(new URL(`/login?error=wrong&next=${encodeURIComponent(next)}`, request.url), 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}
