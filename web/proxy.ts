// Every page and API route needs the login cookie, except the login page
// itself and Next's own files. Next.js 16 calls this file "proxy" (it was
// "middleware" before). Pages send you to /login; API routes
// answer 401 so scripts get a clear error rather than a login page.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionIsValid } from "@/lib/session";

const OPEN_PATHS = ["/login", "/api/login"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.includes(pathname)) return NextResponse.next();
  if (await sessionIsValid(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

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
