// The sign-in cookie. After a member signs in, the site sets its own
// signed cookie so pages can check who is signed in without asking the
// database. The cookie value is
//   userId.teamId.role.issuedAtMs.expiresAtMs.signature
// where the signature is an HMAC-SHA256, made with SITE_SECRET, of
// everything before it. Changing any part breaks the signature. It lasts
// SESSION_DAYS; once it is over RECHECK_HOURS old, the proxy has the
// re-check route confirm the member is still active and issue a new one.
// Uses Web Crypto, which works in the proxy, in API routes and in tests.

export const SESSION_COOKIE = "squadsense_session";
export const SESSION_DAYS = 30;
export const RECHECK_HOURS = 24;
// The route that re-checks a day-old cookie (app/api/session/recheck).
export const RECHECK_PATH = "/api/session/recheck";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const encoder = new TextEncoder();

export type Role = "owner" | "member";

/** Who the cookie says is signed in, and when the cookie was made. */
export interface Session {
  userId: string;
  teamId: number;
  role: Role;
  issuedAt: number;
}

// The signing key, or null when SITE_SECRET is missing or too short to be safe.
async function signingKey(): Promise<CryptoKey | null> {
  const secret = process.env.SITE_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Bytes as lowercase hex text.
function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Hex text back to bytes, or null when it isn't valid hex.
function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

/** True when SITE_SECRET is set and long enough to sign cookies. */
export function sessionSecretConfigured(): boolean {
  return (process.env.SITE_SECRET?.length ?? 0) >= 32;
}

/** A new cookie value for this member, issued now and valid for SESSION_DAYS. */
export async function createSessionValue(member: { userId: string; teamId: number; role: Role }, now = Date.now()): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error("SITE_SECRET must be set to at least 32 characters");
  if (!/^[A-Za-z0-9-]+$/.test(member.userId)) throw new Error("A user id can only hold letters, digits and dashes");
  const body = [member.userId, member.teamId, member.role, now, now + SESSION_DAYS * DAY_MS].join(".");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toHex(signature)}`;
}

// The cookie's parts when they have the right shape, or null.
function parseParts(value: string) {
  const parts = value.split(".");
  if (parts.length !== 6) return null;
  const [userId, team, role, issued, expires, signatureHex] = parts;
  const teamId = Number(team);
  const issuedAt = Number(issued);
  const expiresAt = Number(expires);
  const signature = fromHex(signatureHex);
  if (!/^[A-Za-z0-9-]+$/.test(userId) || (role !== "owner" && role !== "member") || !signature) return null;
  if (![teamId, issuedAt, expiresAt].every((number) => Number.isInteger(number) && number > 0)) return null;
  return { session: { userId, teamId, role: role as Role, issuedAt }, expiresAt, signature, body: parts.slice(0, 5).join(".") };
}

/** Who is signed in, or null when the cookie is missing, malformed, forged or expired. */
export async function readSession(value: string | undefined, now = Date.now()): Promise<Session | null> {
  const key = await signingKey();
  const parsed = key && value ? parseParts(value) : null;
  if (!key || !parsed || parsed.expiresAt < now) return null;
  const genuine = await crypto.subtle.verify("HMAC", key, parsed.signature, encoder.encode(parsed.body));
  return genuine ? parsed.session : null;
}

/** True once a cookie is over RECHECK_HOURS old, so the member's account should be checked again. */
export function needsRecheck(issuedAt: number, now = Date.now()): boolean {
  return now - issuedAt > RECHECK_HOURS * HOUR_MS;
}

/** The cookie settings: unreadable by page scripts, HTTPS only when hosted, kept SESSION_DAYS. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

/** Compares two secrets (a typed password, an invite code) without leaking timing about how much matched. */
export async function secretsMatch(typed: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  // Hash both so the comparison always covers the same number of bytes.
  const [typedHash, expectedHash] = await Promise.all(
    [typed, expected].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))),
  );
  const a = new Uint8Array(typedHash);
  const b = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
