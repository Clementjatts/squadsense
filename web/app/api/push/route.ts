// /api/push saves or removes this device's alert subscription.
// POST {subscription} turns alerts on for the device; DELETE {endpoint}
// turns them off. Subscriptions live in Supabase's push_subscriptions
// table, where the sync job reads them to send alerts. Signing in is
// required, like every API route (see proxy.ts).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// The Supabase client with the server key, or null when Supabase isn't set up (local runs).
function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const NOT_SET_UP = "Alerts need the hosted site: Supabase isn't set up on this copy.";

export async function POST(request: Request) {
  const db = database();
  if (!db) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { subscription } = (await request.json()) as { subscription?: { endpoint?: string } };
  if (!subscription?.endpoint) return NextResponse.json({ error: "No subscription sent" }, { status: 400 });
  const { error } = await db.from("push_subscriptions").upsert({ endpoint: subscription.endpoint, subscription });
  if (error) return NextResponse.json({ error: `Couldn't save the subscription: ${error.message}` }, { status: 502 });
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const db = database();
  if (!db) return NextResponse.json({ error: NOT_SET_UP }, { status: 501 });
  const { endpoint } = (await request.json()) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "No endpoint sent" }, { status: 400 });
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return NextResponse.json({ error: `Couldn't remove the subscription: ${error.message}` }, { status: 502 });
  return NextResponse.json({ removed: true });
}
