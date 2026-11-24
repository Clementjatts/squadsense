// GET /api/calendar/<token>: the deadline calendar a phone subscribes to.
// Calendar apps can't sign in, so proxy.ts lets this path through and the
// token in the address does the checking instead. Deadlines come straight
// from FPL (cached for an hour), so the feed works even when the sync
// doesn't run.

import { NextResponse } from "next/server";
import { calendarToken, deadlineCalendar, type FplEvent } from "@/lib/calendar";

export const dynamic = "force-dynamic";

const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const CACHE_SECONDS = 60 * 60;

// True when the address carries the token made from SITE_SECRET.
async function tokenMatches(token: string): Promise<boolean> {
  const secret = process.env.SITE_SECRET;
  if (!secret || secret.length < 32) return false;
  return token === (await calendarToken(secret));
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await tokenMatches(token))) return new NextResponse("Not found", { status: 404 });

  let events: FplEvent[];
  try {
    const response = await fetch(BOOTSTRAP_URL, { next: { revalidate: CACHE_SECONDS } });
    if (!response.ok) throw new Error(`FPL bootstrap-static returned HTTP ${response.status}`);
    events = ((await response.json()) as { events: FplEvent[] }).events;
  } catch (error) {
    // A failed answer makes the phone keep the copy it already has.
    console.error("Deadline calendar: couldn't read FPL deadlines:", (error as Error).message);
    return new NextResponse("FPL is unavailable", { status: 502 });
  }

  const siteUrl = new URL(request.url).origin;
  return new NextResponse(deadlineCalendar(events, siteUrl, new Date()), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" },
  });
}
