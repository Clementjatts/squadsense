// The forgotten password page: type your email and a reset link is sent
// (by /api/forgot). After sending it shows the same message whatever the
// email, so it never says whether an account exists.

import Link from "next/link";
import { AccountField, AccountStage, SubmitArrow } from "@/components/AccountStage";

export const dynamic = "force-dynamic";

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <AccountStage eyebrow="FORGOT PASSWORD" title="RESET IT" text="Type the email you signed up with and we'll send you a link to choose a new password.">
      {sent ? (
        <p className="signin-note" role="status">If that email has an account, a reset link is on its way. It works for one hour.</p>
      ) : (
        <form className="signin-form" method="post" action="/api/forgot">
          <AccountField icon="mail" name="email" type="email" autoComplete="email" placeholder="Email" autoFocus required />
          <button type="submit" className="signin-submit">
            <span>SEND THE LINK</span>
            <SubmitArrow />
          </button>
        </form>
      )}
      <div className="signin-links">
        <Link href="/login">Back to sign in</Link>
      </div>
    </AccountStage>
  );
}
