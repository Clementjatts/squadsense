// The field checks for the account pages (sign up, reset password), kept
// free of any server code so the browser forms and the API routes use the
// same rules, and tests can check them directly.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_MEMBERS = 20;
const MAX_NAME_LENGTH = 60;

export interface SignupFields {
  inviteCode: string;
  teamId: number;
  name: string;
  email: string;
  password: string;
}

/** An email address trimmed and lowercased, so "Ann@X.com " and "ann@x.com" are the same account. */
export function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True for a whole, positive FPL team id. */
export function isTeamId(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 1_000_000_000;
}

/** What each problem with a new password says. */
export const PASSWORD_PROBLEMS = {
  short: `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "The two passwords don't match.",
};

/** The short code for what's wrong with a new password and its confirmation, or null when both are fine. */
export function passwordProblemCode(password: string, confirm: string): keyof typeof PASSWORD_PROBLEMS | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "short";
  if (password !== confirm) return "mismatch";
  return null;
}

/** What's wrong with a new password and its confirmation in words, or null when both are fine. */
export function passwordProblem(password: string, confirm: string): string | null {
  const code = passwordProblemCode(password, confirm);
  return code && PASSWORD_PROBLEMS[code];
}

/** The sign-up form's fields cleaned up, or the first problem with them in plain words. */
export function checkSignupFields(input: Record<string, unknown>): { fields: SignupFields } | { error: string } {
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  const inviteCode = text("inviteCode").trim();
  const teamId = Number(text("teamId").trim() || input.teamId);
  const name = text("name").trim();
  const email = cleanEmail(input.email);
  if (!inviteCode) return { error: "Enter the invite code you were given." };
  if (!isTeamId(teamId)) return { error: "Your FPL team ID is the number in the address of your Points page on the FPL site." };
  if (!name) return { error: "Enter your name." };
  if (name.length > MAX_NAME_LENGTH) return { error: `Keep your name to ${MAX_NAME_LENGTH} characters.` };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  const problem = passwordProblem(text("password"), text("confirm"));
  if (problem) return { error: problem };
  return { fields: { inviteCode, teamId, name, email, password: text("password") } };
}

/** A redirect target that stays on this site ("/plan"), never another address; "/" otherwise. */
export function safeNextPath(value: unknown): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
