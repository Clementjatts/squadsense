// The dashboard login: one password (SITE_PASSWORD), and a signed cookie
// so you stay signed in for SESSION_DAYS. The cookie holds only an expiry
// time and a signature made with SITE_SECRET, so it can't be forged or
// stretched without the secret. Uses Web Crypto, which works both in the
// proxy (web/proxy.ts) and in API routes.

export const SESSION_COOKIE = "squadsense_session";
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

// The signing key, or null when SITE_SECRET is missing or too short to be safe.
async function signingKey(): Promise<CryptoKey | null> {
  const secret = process.env.SITE_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

/** True when both SITE_PASSWORD and a long enough SITE_SECRET are set. */
export function loginConfigured(): boolean {
  return Boolean(process.env.SITE_PASSWORD) && (process.env.SITE_SECRET?.length ?? 0) >= 32;
}

/** A new cookie value: "<expiry ms>.<signature>". */
export async function createSessionValue(now = Date.now()): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error("SITE_SECRET must be set to at least 32 characters");
  const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(expires));
  return `${expires}.${toHex(signature)}`;
}

/** True if the cookie value was signed with our secret and hasn't expired. */
export async function sessionIsValid(value: string | undefined, now = Date.now()): Promise<boolean> {
  const key = await signingKey();
  if (!key || !value) return false;
  const [expires, signatureHex] = value.split(".");
  const signature = signatureHex ? fromHex(signatureHex) : null;
  if (!expires || !signature || Number(expires) < now) return false;
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(expires));
}

/** Compares a typed password with SITE_PASSWORD without leaking timing about how much matched. */
export async function passwordMatches(typed: string): Promise<boolean> {
  const expected = process.env.SITE_PASSWORD;
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
