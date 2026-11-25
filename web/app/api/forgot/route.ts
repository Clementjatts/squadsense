// POST /api/forgot (form field: email) emails a password reset link.
// Supabase Auth makes a one-time recovery token; the link points at this
// site's /reset page, and the database function send_reset_email sends it
// through Resend in the alerts' layout. The answer is always the same
// ("a reset link is on its way"), so it never says whether an account exists.

import { NextResponse } from "next/server";
import { serverDatabase } from "@/lib/accounts";
import { cleanEmail } from "@/lib/accountRules";

export const dynamic = "force-dynamic";

// The site's own address for the link: SITE_URL when set, otherwise the address this request came to.
function siteOrigin(request: Request): string {
  return (process.env.SITE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

// Makes the recovery link and sends the email. Problems are logged, never shown, so nobody learns which emails have accounts.
async function sendResetLink(email: string, origin: string): Promise<void> {
  const db = serverDatabase();
  if (!db) return console.error("Password reset asked for, but Supabase isn't set up on this copy of the site.");
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
  if (error) return console.warn("No reset link made:", error.message);
  const link = `${origin}/reset?token_hash=${encodeURIComponent(data.properties.hashed_token)}`;
  const sent = await db.rpc("send_reset_email", { email, link });
  if (sent.error) console.error("The reset email wasn't sent:", sent.error.message);
}

export async function POST(request: Request) {
  const email = cleanEmail((await request.formData()).get("email"));
  if (email) await sendResetLink(email, siteOrigin(request));
  return NextResponse.redirect(new URL("/forgot?sent=1", request.url), 303);
}
