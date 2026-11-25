// The sign-in page. With member accounts (Supabase set up) it asks for an
// email and password and links to sign-up and the forgotten password page;
// on a local copy without Supabase it asks only for SITE_PASSWORD, as
// before. The form posts to /api/login, so it works without JavaScript.

import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountField, AccountStage, SubmitArrow } from "@/components/AccountStage";
import { PasswordField } from "@/components/PasswordField";
import { accountsEnabled } from "@/lib/accounts";
import { safeNextPath } from "@/lib/accountRules";
import { SESSION_COOKIE, readSession, sessionSecretConfigured } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  // Worded the same whether or not the email has an account, so it never gives that away.
  wrong: "That email and password don't match. Try again.",
  wrongPassword: "That password isn't right. Try again.",
  inactive: "This account has been switched off. Ask Clement if that's a mistake.",
  failed: "Signing in didn't work just now. Try again in a minute.",
  setup: "Sign-in isn't set up yet. Add SITE_SECRET (and SITE_PASSWORD on a copy without Supabase) to web/.env.local (see the README).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: requested, error } = await searchParams;
  const next = safeNextPath(requested);
  // Already signed in: go straight on.
  if (await readSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);
  const accounts = accountsEnabled();
  const errorKey = error === "wrong" && !accounts ? "wrongPassword" : error;
  const message = !sessionSecretConfigured() ? ERRORS.setup : errorKey ? ERRORS[errorKey] ?? ERRORS.failed : null;
  return (
    <AccountStage eyebrow="PRIVATE DASHBOARD" title="WELCOME BACK" text="Sign in to see your squad, plans and mini-leagues.">
      <form className="signin-form" method="post" action="/api/login">
        {accounts && <AccountField icon="mail" name="email" type="email" autoComplete="email" placeholder="Email" autoFocus required />}
        <PasswordField autoFocus={!accounts} />
        <input type="hidden" name="next" value={next} />
        {message && <p className="signin-error" role="alert">{message}</p>}
        <button type="submit" className="signin-submit">
          <span>SIGN IN</span>
          <SubmitArrow />
        </button>
      </form>
      {accounts && (
        <div className="signin-links">
          <Link href="/forgot">Forgot password?</Link>
          <Link href="/signup">New here? Create an account</Link>
        </div>
      )}
      <span className="signin-footnote">Stays signed in on this device for 30 days.</span>
    </AccountStage>
  );
}
