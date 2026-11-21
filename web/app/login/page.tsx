// The sign-in page: one password, centred on a dark "stadium" stage with
// faint pitch markings. The form posts to /api/login, so it works
// without JavaScript; the password box adds show/hide when it's there.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { PasswordField } from "@/components/PasswordField";
import { SESSION_COOKIE, loginConfigured, sessionIsValid } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: "That password isn't right. Try again.",
  setup: "Sign-in isn't set up yet. Add SITE_PASSWORD and SITE_SECRET to web/.env.local (see the README).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  // Already signed in: go straight on (only to a page on this site).
  if (await sessionIsValid((await cookies()).get(SESSION_COOKIE)?.value)) {
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }
  const message = !loginConfigured() ? ERRORS.setup : error ? ERRORS[error] : null;
  return (
    <main className="signin-stage">
      <PitchMarkings />
      <span className="signin-glow signin-glow-lime" aria-hidden="true" />
      <span className="signin-glow signin-glow-blue" aria-hidden="true" />

      <form className="signin-card" method="post" action="/api/login">
        <span className="signin-stripe" aria-hidden="true" />
        <div className="signin-brand">
          <BrandMark size={40} />
          <span className="signin-wordmark">SQUADSENSE</span>
        </div>

        <div className="signin-heading">
          <span className="signin-eyebrow">PRIVATE DASHBOARD</span>
          <h1>WELCOME BACK</h1>
          <p>Sign in to see your squad, plans and mini-leagues.</p>
        </div>

        <PasswordField />
        <input type="hidden" name="next" value={next} />
        {message && <p className="signin-error" role="alert">{message}</p>}

        <button type="submit" className="signin-submit">
          <span>SIGN IN</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
        <span className="signin-footnote">Stays signed in on this device for 30 days.</span>
      </form>
    </main>
  );
}

// A faint pitch outline behind the card: halfway line, centre circle and both boxes.
function PitchMarkings() {
  return (
    <svg className="signin-pitch" viewBox="0 0 1050 680" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="25" y="25" width="1000" height="630" />
      <line x1="525" y1="25" x2="525" y2="655" />
      <circle cx="525" cy="340" r="92" />
      <circle cx="525" cy="340" r="4" className="signin-pitch-spot" />
      <rect x="25" y="178" width="165" height="324" />
      <rect x="860" y="178" width="165" height="324" />
      <rect x="25" y="258" width="55" height="164" />
      <rect x="970" y="258" width="55" height="164" />
    </svg>
  );
}
