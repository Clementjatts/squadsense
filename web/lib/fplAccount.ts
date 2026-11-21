// Signing in to your FPL account and changing your team. Server only.
//
// FPL signs in through account.premierleague.com with OAuth and PKCE:
// open the sign-in page, run its three-step form (the last step carries
// your email and password), hand the result back, and swap the code you
// get for an access token. Requests to your team then carry that token.
//
// The steps follow AIrsenal's fpl_auth.py (github.com/alan-turing-institute/AIrsenal,
// MIT licence, crediting "@Moose on the FPLDev Discord" for the original).
// Unlike AIrsenal, this doesn't disguise itself as a Chrome browser, so if
// FPL starts refusing scripts this will fail with a clear error rather
// than work around it.
//
// Nothing here runs unless FPL_EMAIL and FPL_PASSWORD are set in
// web/.env.local, and the API route only allows it from this Mac.

import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const LOGIN_BASE = "https://account.premierleague.com";
const API_HOME = "https://fantasy.premierleague.com/api";
const CLIENT_ID = "bfcbaf69-aade-4c1b-8f00-c1cb8a193030";
const STANDARD_CONNECTION_ID = "867ed4363b2bc21c860085ad2baa817d";
const REDIRECT_URI = "https://fantasy.premierleague.com/";
const NEXT_EVENT = { constructType: "skEvent", eventName: "continue", params: [], eventType: "post", postProcess: {} };
const MAX_REDIRECTS = 10;

export class FplAccountError extends Error {}

/** A pick as FPL's my-team endpoint returns it (prices in tenths of a million). */
export interface MyTeamPick {
  element: number;
  position: number;
  selling_price: number;
  purchase_price: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface MyTeam {
  picks: MyTeamPick[];
  chips: { name: string; status_for_entry: string }[];
  transfers: { bank: number; limit: number | null; made: number; cost: number };
}

/** Holds the cookies the sign-in pages set, and sends them back on later steps. */
class CookieJar {
  private cookies = new Map<string, string>();

  store(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const equals = pair.indexOf("=");
      if (equals > 0) this.cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** Your FPL email and password from web/.env.local, or null if either is missing. */
export function fplCredentials(): { email: string; password: string } | null {
  const email = process.env.FPL_EMAIL;
  const password = process.env.FPL_PASSWORD;
  return email && password ? { email, password } : null;
}

// A request that keeps the cookie jar up to date and follows redirects by hand,
// so cookies set along the way aren't lost.
async function send(jar: CookieJar, url: string, init: RequestInit = {}, followRedirects = true): Promise<Response> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(target, { ...init, redirect: "manual", headers: { ...init.headers, Cookie: jar.header() } });
    jar.store(response);
    const location = response.headers.get("location");
    if (!followRedirects || response.status < 300 || response.status >= 400 || !location) return response;
    target = new URL(location, target).toString();
    init = { method: "GET" };
  }
  throw new FplAccountError("FPL sign-in redirected too many times");
}

// The first match of `pattern` in `text`, or a clear error naming the step.
function find(pattern: RegExp, text: string, step: string): string {
  const match = text.match(pattern);
  if (!match) throw new FplAccountError(`FPL sign-in failed at "${step}". FPL may have changed its sign-in page.`);
  return match[1];
}

// Named fields from a JSON response, or a clear error naming the step.
async function fields(response: Response, keys: string[], step: string): Promise<string[]> {
  const body = (await response.json().catch(() => null)) as Record<string, string> | null;
  if (!body || keys.some((key) => !(key in body))) {
    throw new FplAccountError(`FPL sign-in failed at "${step}" (HTTP ${response.status}). Check your email and password.`);
  }
  return keys.map((key) => body[key]);
}

/** Signs in and returns the header later requests need. Throws FplAccountError if any step fails. */
export async function signIn(email: string, password: string): Promise<Record<string, string>> {
  const jar = new CookieJar();
  const verifier = randomBytes(64).toString("base64url").slice(0, 128);
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const authorise = new URL(`${LOGIN_BASE}/as/authorize`);
  Object.entries({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "openid profile email offline_access",
    state: randomUUID().replace(/-/g, ""), code_challenge: challenge, code_challenge_method: "S256",
  }).forEach(([name, value]) => authorise.searchParams.set(name, value));
  const page = await (await send(jar, authorise.toString())).text();
  const pageToken = find(/"accessToken":"([^"]+)"/, page, "reading the sign-in page");
  const state = find(/<input[^>]+name="state"[^>]+value="([^"]+)"/, page, "reading the sign-in page");

  const tokenHeaders = { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" };
  const start = await send(jar, `${LOGIN_BASE}/davinci/policy/262ce4b01d19dd9d385d26bddb4297b6/start`, { method: "POST", headers: tokenHeaders });
  const [interactionId, firstId] = await fields(start, ["interactionId", "id"], "starting sign-in");

  const formUrl = (connection: string) => `${LOGIN_BASE}/davinci/connections/${connection}/capabilities/customHTMLTemplate`;
  const interactionHeaders = { interactionId, "Content-Type": "application/json" };
  const poll = await send(jar, formUrl(STANDARD_CONNECTION_ID), {
    method: "POST", headers: interactionHeaders,
    body: JSON.stringify({ id: firstId, eventName: "continue", parameters: { eventType: "polling" }, pollProps: { status: "continue", delayInMs: 10, retriesAllowed: 1, pollChallengeStatus: false } }),
  });
  const [secondId] = await fields(poll, ["id"], "sign-in step 1");

  const signOn = await send(jar, formUrl(STANDARD_CONNECTION_ID), {
    method: "POST", headers: interactionHeaders,
    body: JSON.stringify({ id: secondId, nextEvent: NEXT_EVENT, parameters: { buttonType: "form-submit", buttonValue: "SIGNON", username: email, password }, eventName: "continue" }),
  });
  const [thirdId, connectionId] = await fields(signOn, ["id", "connectionId"], "sign-in step 2 (email and password)");

  const finish = await send(jar, formUrl(connectionId), {
    method: "POST", headers: tokenHeaders,
    body: JSON.stringify({ id: thirdId, nextEvent: NEXT_EVENT, parameters: { buttonType: "form-submit", buttonValue: "SIGNON" }, eventName: "continue" }),
  });
  const [dvResponse] = await fields(finish, ["dvResponse"], "sign-in step 3");

  const resume = await send(jar, `${LOGIN_BASE}/as/resume`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ dvResponse, state }).toString(),
  }, false);
  const code = find(/[?&]code=([^&]+)/, resume.headers.get("location") ?? "", "returning to FPL");

  const token = await send(jar, `${LOGIN_BASE}/as/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code, code_verifier: verifier, client_id: CLIENT_ID }).toString(),
  });
  const [accessToken] = await fields(token, ["access_token"], "getting the access token");
  const headers = { "X-API-Authorization": `Bearer ${accessToken}` };

  const me = await fetch(`${API_HOME}/me/`, { headers });
  const meBody = (await me.json().catch(() => null)) as { player?: unknown } | null;
  if (!meBody?.player) throw new FplAccountError("Signed in, but FPL wouldn't show your account details.");
  return headers;
}

/** Your team as FPL sees it right now: picks with selling prices, chips and free transfers. */
export async function getMyTeam(headers: Record<string, string>, teamId: number): Promise<MyTeam> {
  const response = await fetch(`${API_HOME}/my-team/${teamId}/`, { headers, cache: "no-store" });
  if (!response.ok) throw new FplAccountError(`FPL wouldn't return your team (HTTP ${response.status})`);
  return (await response.json()) as MyTeam;
}

// Sends a change to FPL. FPL reports some refusals in the body with HTTP 200, so both are checked.
async function post(headers: Record<string, string>, path: string, body: unknown, what: string): Promise<void> {
  const response = await fetch(`${API_HOME}/${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok || text.includes("non_form_errors") || text.includes("non_field_errors")) {
    throw new FplAccountError(`FPL refused the ${what} (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
}

/** Makes transfers. Can't be undone. */
export function postTransfers(headers: Record<string, string>, payload: unknown): Promise<void> {
  return post(headers, "transfers/", payload, "transfers");
}

/** Sets the starting eleven, bench order, captain and vice (and a lineup chip, if given). */
export function postLineup(headers: Record<string, string>, teamId: number, payload: unknown): Promise<void> {
  return post(headers, `my-team/${teamId}/`, payload, "lineup");
}
