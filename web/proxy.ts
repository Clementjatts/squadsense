// Every page and API route needs the sign-in cookie, except the account
// pages (sign in, sign up, forgotten password) and Next's own files.
// Next.js 16 calls this file "proxy" (it was "middleware" before). Pages
// send you to /login; API routes answer 401 so scripts get a clear error
// rather than a login page. Once a cookie is over a day old, the request
// goes through the re-check route first, which confirms the account is
// still active and issues a fresh cookie: at most one database read a day
// per person, and a removed member is out within a day.

import { NextResponse, type NextRequest } from "next/server";
import { RECHECK_PATH, SESSION_COOKIE, needsRecheck, readSession } from "@/lib/session";

// The account pages and their APIs, plus the files a phone fetches without
// the cookie: the service worker, the app manifest and the icons. The
// re-check route reads the cookie itself.
const OPEN_PATHS = [
  "/login", "/signup", "/forgot", "/reset",
  "/api/login", "/api/signup", "/api/signup/team", "/api/forgot", "/api/reset", RECHECK_PATH,
  "/sw.js", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
];
// The deadline calendar is open too, because calendar apps can't sign in;
// its route checks the secret token in the address itself.
const OPEN_PREFIXES = ["/api/calendar/"];

// Lets a signed-in request through, sends a day-old cookie to be re-checked, or turns the visitor away.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.includes(pathname) || OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session && needsRecheck(session.issuedAt)) {
    const recheck = new URL(RECHECK_PATH, request.url);
    recheck.searchParams.set("next", pathname + search);
    // 307 keeps the method and body, so an API call carries on after the re-check.
    return NextResponse.redirect(recheck, 307);
  }
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Skip Next's build files and the favicon, which the login page needs too.
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
