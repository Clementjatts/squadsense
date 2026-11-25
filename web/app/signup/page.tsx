// The sign-up page: friends and family with the invite code create their
// own account for their own FPL team. Closed (with a message) when
// INVITE_CODE isn't set or Supabase isn't set up on this copy of the site.

import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountStage } from "@/components/AccountStage";
import { SignupForm } from "@/components/SignupForm";
import { accountsEnabled } from "@/lib/accounts";
import { SESSION_COOKIE, readSession, sessionSecretConfigured } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await readSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/");
  const open = accountsEnabled() && Boolean(process.env.INVITE_CODE) && sessionSecretConfigured();
  return (
    <AccountStage eyebrow="JOIN WITH AN INVITE" title="CREATE ACCOUNT" text="Your own SquadSense for your own FPL team. You need the invite code Clement gave you.">
      {open ? <SignupForm /> : <p className="signin-error" role="alert">Sign-up is closed.</p>}
      <div className="signin-links">
        <Link href="/login">Already have an account? Sign in</Link>
      </div>
    </AccountStage>
  );
}
