"use client";

// The sign-up form. As you type your FPL team ID it looks the team up
// (/api/signup/team) and shows "Team: X, manager Y", so you can see it's
// the right one before creating the account. Sending it calls /api/signup,
// which signs you in; then it opens the dashboard.

import { useEffect, useState } from "react";
import { AccountField, SubmitArrow } from "./AccountStage";
import { PasswordField } from "./PasswordField";
import { MIN_PASSWORD_LENGTH, checkSignupFields, isTeamId } from "@/lib/accountRules";

type Lookup = { kind: "none" } | { kind: "checking" } | { kind: "found"; teamName: string; manager: string } | { kind: "error"; message: string };

const LOOKUP_DELAY_MS = 500;

// Looks up the typed team id half a second after typing stops.
function useTeamLookup(teamId: string): Lookup {
  const [lookup, setLookup] = useState<Lookup>({ kind: "none" });
  useEffect(() => {
    if (!isTeamId(Number(teamId))) {
      setLookup({ kind: "none" });
      return;
    }
    setLookup({ kind: "checking" });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/signup/team?id=${Number(teamId)}`);
        const result = await response.json();
        setLookup(response.ok ? { kind: "found", ...result } : { kind: "error", message: result.error ?? `Lookup failed (HTTP ${response.status})` });
      } catch (error) {
        setLookup({ kind: "error", message: (error as Error).message });
      }
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [teamId]);
  return lookup;
}

// Sends the form to /api/signup. Returns the error to show, or null once signed in.
async function createAccount(form: HTMLFormElement): Promise<string | null> {
  const fields = Object.fromEntries(new FormData(form).entries());
  const checked = checkSignupFields(fields);
  if ("error" in checked) return checked.error;
  const response = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  const result = await response.json();
  return response.ok ? null : result.error ?? `Sign-up failed (HTTP ${response.status})`;
}

export function SignupForm() {
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lookup = useTeamLookup(teamId);

  // Creates the account, then opens the dashboard (which says when the team is still being read).
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    try {
      const problem = await createAccount(event.currentTarget);
      if (!problem) return window.location.assign("/");
      setError(problem);
    } catch (failure) {
      setError(`Sign-up didn't go through: ${(failure as Error).message}`);
    }
    setSending(false);
  }

  return (
    <form className="signin-form" onSubmit={submit} noValidate>
      <AccountField icon="key" name="inviteCode" placeholder="Invite code" autoComplete="off" autoFocus required />
      <div className="signin-field-wrap">
        <AccountField icon="shirt" name="teamId" placeholder="FPL team ID" inputMode="numeric" value={teamId} onChange={(event) => setTeamId(event.target.value.trim())} required />
        <TeamLine lookup={lookup} />
      </div>
      <AccountField icon="user" name="name" placeholder="Your name" autoComplete="name" required />
      <AccountField icon="mail" name="email" type="email" placeholder="Email" autoComplete="email" required />
      <PasswordField placeholder={`Password (${MIN_PASSWORD_LENGTH}+ characters)`} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      <PasswordField name="confirm" placeholder="Password again" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      {error && <p className="signin-error" role="alert">{error}</p>}
      <button type="submit" className="signin-submit" disabled={sending}>
        <span>{sending ? "CREATING..." : "CREATE ACCOUNT"}</span>
        <SubmitArrow />
      </button>
    </form>
  );
}

// The line under the team ID box: where to find it, the team found, or why not.
function TeamLine({ lookup }: { lookup: Lookup }) {
  if (lookup.kind === "found") return <span className="signin-hint signin-hint-found">Team: {lookup.teamName}, manager {lookup.manager}</span>;
  if (lookup.kind === "checking") return <span className="signin-hint">Looking up the team...</span>;
  if (lookup.kind === "error") return <span className="signin-hint signin-hint-warn">{lookup.message}</span>;
  return <span className="signin-hint">The number in the address of your Points page on the FPL site.</span>;
}
