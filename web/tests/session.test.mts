// Checks for lib/session.ts (the signed sign-in cookie and the daily
// re-check rule) and lib/accountRules.ts (the sign-up and password checks).
// Run with: npm test

process.env.SITE_SECRET = "test-secret-that-is-at-least-32-characters-long";

const { createSessionValue, needsRecheck, readSession, SESSION_DAYS } = await import("../lib/session.ts");
const { checkSignupFields, passwordProblem, safeNextPath } = await import("../lib/accountRules.ts");

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 25, 12);
const MEMBER = { userId: "3f2b9c1e-0a4d-4e7b-9c55-1d2e3f4a5b6c", teamId: 4242, role: "member" as const };

// --- Signing and reading ---
const cookie = await createSessionValue(MEMBER, NOW);
const read = await readSession(cookie, NOW + HOUR);
check("a fresh cookie has six dot-separated parts", cookie.split(".").length === 6);
check("a fresh cookie reads back as the same member", read?.userId === MEMBER.userId && read?.teamId === 4242 && read?.role === "member");
check("the cookie records when it was issued", read?.issuedAt === NOW);
check("a cookie still works on its last day", (await readSession(cookie, NOW + SESSION_DAYS * 24 * HOUR - HOUR)) !== null);
check("a cookie stops working after 30 days", (await readSession(cookie, NOW + SESSION_DAYS * 24 * HOUR + HOUR)) === null);

// --- Tampering ---
const parts = cookie.split(".");
const withPart = (index: number, value: string) => parts.map((part, at) => (at === index ? value : part)).join(".");
check("changing the team id breaks the signature", (await readSession(withPart(1, "11304359"), NOW)) === null);
check("changing the role to owner breaks the signature", (await readSession(withPart(2, "owner"), NOW)) === null);
check("changing the user id breaks the signature", (await readSession(withPart(0, "someone-else"), NOW)) === null);
check("stretching the expiry breaks the signature", (await readSession(withPart(4, String(NOW + 400 * 24 * HOUR)), NOW)) === null);
check("a later issue time to put off the re-check breaks the signature", (await readSession(withPart(3, String(NOW + 20 * HOUR)), NOW)) === null);
check("a cookie with a made-up signature is rejected", (await readSession(withPart(5, "ab".repeat(32)), NOW)) === null);
check("a role that isn't owner or member is rejected", (await readSession(withPart(2, "admin"), NOW)) === null);
check("a missing cookie is rejected", (await readSession(undefined, NOW)) === null);
check("rubbish is rejected", (await readSession("not-a-cookie", NOW)) === null);

// The cookie before member accounts was "<expiry ms>.<signature>".
check("an old-format cookie is rejected", (await readSession(`${NOW + 10 * 24 * HOUR}.${"ab".repeat(32)}`, NOW)) === null);

// A different secret (another copy of the site) can't read this cookie.
process.env.SITE_SECRET = "a-completely-different-secret-of-32-plus-chars";
check("a cookie signed with another secret is rejected", (await readSession(cookie, NOW)) === null);
process.env.SITE_SECRET = "short";
check("nothing is accepted when SITE_SECRET is too short", (await readSession(cookie, NOW)) === null);
process.env.SITE_SECRET = "test-secret-that-is-at-least-32-characters-long";

// --- The daily re-check ---
check("no re-check for a cookie an hour old", !needsRecheck(NOW, NOW + HOUR));
check("no re-check at exactly 24 hours", !needsRecheck(NOW, NOW + 24 * HOUR));
check("a re-check once the cookie is over 24 hours old", needsRecheck(NOW, NOW + 24 * HOUR + 1));
check("a re-check for a cookie a week old", needsRecheck(NOW, NOW + 7 * 24 * HOUR));

// --- Sign-up fields ---
const good = { inviteCode: "kickoff", teamId: "4242", name: "Ann", email: " Ann@Example.com ", password: "long-enough-1", confirm: "long-enough-1" };
const signup = checkSignupFields(good);
check("good sign-up fields pass", "fields" in signup);
check("the email is trimmed and lowercased", "fields" in signup && signup.fields.email === "ann@example.com");
check("the team id becomes a number", "fields" in signup && signup.fields.teamId === 4242);
const refused = (fields: Record<string, unknown>) => "error" in checkSignupFields({ ...good, ...fields });
check("no invite code is refused", refused({ inviteCode: " " }));
check("a team id with letters is refused", refused({ teamId: "42a" }));
check("a team id of zero is refused", refused({ teamId: "0" }));
check("a fractional team id is refused", refused({ teamId: "12.5" }));
check("a missing name is refused", refused({ name: "" }));
check("a name over 60 characters is refused", refused({ name: "x".repeat(61) }));
check("an email without an @ is refused", refused({ email: "ann.example.com" }));
check("a 9-character password is refused", refused({ password: "123456789", confirm: "123456789" }));
check("passwords that don't match are refused", refused({ confirm: "long-enough-2" }));
check("a 10-character password is fine", passwordProblem("1234567890", "1234567890") === null);
check("the short password message names the minimum", passwordProblem("short", "short")?.includes("10") === true);

// --- Redirects after signing in ---
check("a page on this site is kept", safeNextPath("/plan?week=12") === "/plan?week=12");
check("another site is replaced with /", safeNextPath("https://evil.example") === "/");
check("a protocol-relative address is replaced with /", safeNextPath("//evil.example") === "/");
check("a backslash trick is replaced with /", safeNextPath("/\\evil.example") === "/");
check("nothing sent means /", safeNextPath(null) === "/");
