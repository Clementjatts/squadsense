// /api/push saves or removes this device's alert subscription.
// POST {subscription} turns alerts on for the device; DELETE {endpoint}
// turns them off. Subscriptions live in Supabase's push_subscriptions
// table with the signed-in member's team id, and the sync sends each
// team's alerts only to that team's devices. Signing in is required, like
// every API route (see proxy.ts).

import { NextResponse } from "next/server";
import { serverDatabase } from "@/lib/accounts";
import { currentTeam } from "@/lib/currentTeam";

export const dynamic = "force-dynamic";

const NOT_SET_UP = "Alerts need the hosted site: Supabase isn't set up on this copy.";

export async function POST(request: Request) {
  const db = serverDatabase();
  if (!db) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { subscription } = (await request.json()) as { subscription?: { endpoint?: string } };
  if (!subscription?.endpoint) return NextResponse.json({ error: "No subscription sent" }, { status: 400 });
  const { teamId } = await currentTeam();
  const { error } = await db.from("push_subscriptions").upsert({ endpoint: subscription.endpoint, subscription, team_id: teamId });
  if (error) return NextResponse.json({ error: `Couldn't save the subscription: ${error.message}` }, { status: 502 });
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const db = serverDatabase();
  if (!db) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { endpoint } = (await request.json()) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "No endpoint sent" }, { status: 400 });
  const { teamId } = await currentTeam();
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("team_id", teamId);
  if (error) return NextResponse.json({ error: `Couldn't remove the subscription: ${error.message}` }, { status: 502 });
  return NextResponse.json({ removed: true });
}
