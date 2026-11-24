// GET /api/calendar-link: the address of your deadline calendar, for the
// bell menu. Needs the login cookie (proxy.ts), so only you can read it.
// The link uses webcal://, which makes a phone offer to subscribe.

import { NextResponse } from "next/server";
import { calendarToken } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.SITE_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "The calendar needs SITE_SECRET to be set." }, { status: 503 });
  }
  const host = new URL(request.url).host;
  return NextResponse.json({ url: `webcal://${host}/api/calendar/${await calendarToken(secret)}` });
}
