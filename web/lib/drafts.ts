// Transfer Planner drafts: what you've planned (moves, chips, captains and
// lineups), saved so a reload or another device picks up where you left
// off. Drafts go to Supabase through /api/drafts; when that isn't
// available they're kept in this browser instead, and the Planner says so.
//
// "current" is saved as you plan. Up to MAX_NAMED_DRAFTS more are named
// scenarios, such as "Roll GW12" against "Wildcard GW12", to compare.

import type { LineupChoice, PlannedCaptains, PlannedChips, PlannedLineups, PlannedMove } from "./planning";
import type { Snapshot } from "./types";

export const CURRENT_DRAFT = "current";
export const MAX_NAMED_DRAFTS = 3;
const NAME_LENGTH = 30;
const BROWSER_KEY = "squadsense.plannerDrafts";

export interface PlannerDraft {
  moves: PlannedMove[];
  chips: PlannedChips;
  captains: PlannedCaptains;
  lineups: PlannedLineups;
}

export interface SavedDraft {
  name: string;
  draft: PlannerDraft;
  updatedAt: string;
}

// Where drafts are being kept right now, and why when it's the browser.
export interface DraftStore {
  where: "shared" | "browser";
  reason: string | null;
}

/** A draft name with spaces trimmed and cut to NAME_LENGTH characters, or "" if nothing is left. */
export function cleanDraftName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, NAME_LENGTH);
}

// Keeps only the entries of a gameweek-keyed record whose week is still being planned.
function keepWeeks<T>(record: Partial<Record<number, T>> | undefined, weeks: number[]): Partial<Record<number, T>> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([week]) => weeks.includes(Number(week))));
}

/**
 * Fits a saved draft to today's snapshot. Weeks that have passed are
 * dropped, and so are moves naming a player the snapshot doesn't know.
 * The Planner's own rules then report anything that no longer works (a
 * move selling someone you've since sold, for example).
 */
export function draftForSnapshot(draft: Partial<PlannerDraft>, snapshot: Snapshot): PlannerDraft {
  const known = (id: number) => snapshot.players[String(id)] !== undefined;
  return {
    moves: (draft.moves ?? []).filter((move) => snapshot.weeks.includes(move.week) && known(move.outId) && known(move.inId)),
    chips: keepWeeks(draft.chips, snapshot.weeks),
    captains: keepWeeks(draft.captains, snapshot.weeks),
    lineups: keepWeeks<LineupChoice>(draft.lineups, snapshot.weeks),
  };
}

/** True when a draft has nothing in it, so there's nothing worth restoring. */
export function isEmptyDraft(draft: PlannerDraft): boolean {
  return draft.moves.length === 0 && [draft.chips, draft.captains, draft.lineups].every((record) => Object.values(record).every((value) => value === undefined));
}

// The drafts kept in this browser, by name. Storage can be blocked
// (private browsing), in which case this says so and starts empty.
function browserDrafts(): Record<string, SavedDraft> {
  try {
    return JSON.parse(window.localStorage.getItem(BROWSER_KEY) ?? "{}") as Record<string, SavedDraft>;
  } catch (error) {
    console.warn("Couldn't read the drafts saved in this browser:", error);
    return {};
  }
}

// Writes the browser's drafts back, reporting (not hiding) a failure.
function writeBrowserDrafts(drafts: Record<string, SavedDraft>): void {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.warn("Couldn't save the draft in this browser; it will be lost when you leave the page:", error);
  }
}

// Calls /api/drafts. Returns the JSON body, or throws an Error carrying the
// route's own explanation, so callers can show it and fall back.
async function callDrafts(method: "GET" | "PUT" | "DELETE", body?: object): Promise<Record<string, unknown>> {
  const response = await fetch("/api/drafts", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String(result.error ?? `Drafts request failed with status ${response.status}`)), { status: response.status });
  return result;
}

// True for an error that means "keep using the browser" (no Supabase or no
// table yet) rather than a real problem to show.
function meansUseBrowser(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 501 || status === 503;
}

/** Every saved draft, newest first, and where they're being kept. */
export async function loadDrafts(): Promise<{ store: DraftStore; drafts: SavedDraft[] }> {
  try {
    const result = await callDrafts("GET");
    return { store: { where: "shared", reason: null }, drafts: result.drafts as SavedDraft[] };
  } catch (error) {
    if (!meansUseBrowser(error)) console.warn("Couldn't load drafts from Supabase; using this browser:", error);
    const drafts = Object.values(browserDrafts()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { store: { where: "browser", reason: (error as Error).message }, drafts };
  }
}

/**
 * Saves one draft where drafts are being kept, falling back to the
 * browser if Supabase fails. Returns the store actually used. A refusal
 * (too many scenarios, say) is thrown for the Planner to show.
 */
export async function saveDraft(name: string, draft: PlannerDraft, store: DraftStore): Promise<DraftStore> {
  if (store.where === "shared") {
    try {
      await callDrafts("PUT", { name, draft });
      return store;
    } catch (error) {
      if ((error as { status?: number }).status === 409) throw error;
      console.warn("Couldn't save the draft to Supabase; saving it in this browser:", error);
      saveInBrowser(name, draft);
      return { where: "browser", reason: (error as Error).message };
    }
  }
  const named = Object.keys(browserDrafts()).filter((each) => each !== CURRENT_DRAFT && each !== name);
  if (name !== CURRENT_DRAFT && named.length >= MAX_NAMED_DRAFTS) throw new Error(`You can keep ${MAX_NAMED_DRAFTS} scenarios. Delete one first.`);
  saveInBrowser(name, draft);
  return store;
}

// Stores one draft in this browser under its name.
function saveInBrowser(name: string, draft: PlannerDraft): void {
  writeBrowserDrafts({ ...browserDrafts(), [name]: { name, draft, updatedAt: new Date().toISOString() } });
}

/** Deletes one draft from wherever drafts are being kept. Errors are thrown for the Planner to show. */
export async function deleteDraft(name: string, store: DraftStore): Promise<void> {
  if (store.where === "shared") {
    await callDrafts("DELETE", { name });
    return;
  }
  const drafts = browserDrafts();
  delete drafts[name];
  writeBrowserDrafts(drafts);
}
