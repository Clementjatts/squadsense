// The reset password page, opened from the link in the reset email
// (/reset?token_hash=...). Choose a new password twice; /api/reset saves it
// and signs you in.

import Link from "next/link";
import { AccountStage, SubmitArrow } from "@/components/AccountStage";
import { PasswordField } from "@/components/PasswordField";
import { MIN_PASSWORD_LENGTH, PASSWORD_PROBLEMS } from "@/lib/accountRules";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  ...PASSWORD_PROBLEMS,
  expired: "This reset link has expired or was already used. Ask for a new one.",
  inactive: "Your password was changed, but this account has been switched off. Ask Clement if that's a mistake.",
  failed: "The new password couldn't be saved. Ask for a new link and try again.",
  setup: "Password resets aren't set up on this copy of the site.",
};

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; error?: string }> }) {
  const { token_hash: tokenHash, error } = await searchParams;
  const message = error ? ERRORS[error] ?? ERRORS.failed : tokenHash ? null : ERRORS.expired;
  return (
    <AccountStage eyebrow="NEW PASSWORD" title="CHOOSE ONE" text={`Pick a new password of at least ${MIN_PASSWORD_LENGTH} characters. You'll be signed in straight after.`}>
      {tokenHash && (
        <form className="signin-form" method="post" action="/api/reset">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <PasswordField placeholder="New password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} autoFocus />
          <PasswordField name="confirm" placeholder="New password again" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
          {message && <p className="signin-error" role="alert">{message}</p>}
          <button type="submit" className="signin-submit">
            <span>SAVE AND SIGN IN</span>
            <SubmitArrow />
          </button>
        </form>
      )}
      {!tokenHash && message && <p className="signin-error" role="alert">{message}</p>}
      <div className="signin-links">
        <Link href="/forgot">Ask for a new link</Link>
        <Link href="/login">Back to sign in</Link>
      </div>
    </AccountStage>
  );
}
