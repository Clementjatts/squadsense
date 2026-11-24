// Loads the latest snapshot for the team. Runs on the server only, so the
// Supabase service key never reaches the browser.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LivePicks, PlayerDetail, Snapshot } from "./types";

export interface LoadedSnapshot {
  snapshot: Snapshot;
  isDemo: boolean;
}

// What the sync job actually writes: the snapshot plus every player's
// detail entry. Pages never get the details; the player panel asks for
// one player at a time through getPlayerDetail().
type SnapshotFile = Snapshot & { playerDetails?: Record<string, PlayerDetail>; livePicks?: LivePicks | null };

interface LoadedFile {
  file: SnapshotFile;
  isDemo: boolean;
}
const DATA_FOLDER = path.join(process.cwd(), "data");
// Written by the sync job: python -m squadsense.sync --web-snapshot ../web/data/snapshot.json
const LOCAL_SNAPSHOT = path.join(DATA_FOLDER, "snapshot.json");
// Made-up data, only used before the sync has ever run.
const SAMPLE_SNAPSHOT = path.join(DATA_FOLDER, "sample-snapshot.json");

// Reads a snapshot file. Returns null if the file doesn't exist; any other
// problem (bad JSON, no permission) is a real error and is thrown.
async function readSnapshotFile(filePath: string): Promise<SnapshotFile | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as SnapshotFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Without Supabase we use the real snapshot the sync wrote on this Mac,
// and only fall back to the sample if the sync has never run.
async function loadLocalFile(): Promise<LoadedFile> {
  const real = await readSnapshotFile(LOCAL_SNAPSHOT);
  if (real) return { file: real, isDemo: false };
  const sample = await readSnapshotFile(SAMPLE_SNAPSHOT);
  if (!sample) throw new Error(`No snapshot found. Run the sync job to create ${LOCAL_SNAPSHOT}.`);
  return { file: sample, isDemo: true };
}

// How long a page snapshot from Supabase is reused before asking again.
// The sync writes a new one every 2 hours (or about 5 minutes after "Done
// on FPL"), so a minute's delay is never noticed, while moving between
// pages no longer waits for the database each time.
const PAGE_CACHE_SECONDS = 60;

interface SupabaseSetup {
  supabase: SupabaseClient;
  teamId: number;
}

// The Supabase client and team id, or null when Supabase isn't set up (local files are used then).
function supabaseSetup(): SupabaseSetup | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const teamId = Number(process.env.FPL_TEAM_ID);
  if (!teamId) throw new Error("FPL_TEAM_ID is missing or not a number. Check .env.local.");
  return { supabase: createClient(url, serviceKey, { auth: { persistSession: false } }), teamId };
}

// The latest row's chosen column from a table or view, for the team. Throws with a plain message on failure.
async function latest<T>(setup: SupabaseSetup, table: string, column: string): Promise<T> {
  const { data, error } = await setup.supabase
    .from(table)
    .select(column)
    .eq("team_id", setup.teamId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the snapshot from Supabase: ${error.message}`);
  if (!data) throw new Error(`No snapshot yet for team ${setup.teamId}. Run the sync job first.`);
  return Object.values(data as unknown as Record<string, T>)[0];
}

// The page snapshot from Supabase: the page_snapshots view leaves out the
// player details and live picks, which are most of the 2.5 MB. Kept in
// Next's data cache for PAGE_CACHE_SECONDS, shared by every page.
const cachedPageSnapshot = unstable_cache(
  async (teamId: number) => {
    const setup = supabaseSetup();
    if (!setup || setup.teamId !== teamId) throw new Error("Supabase settings changed while loading the snapshot.");
    return latest<Snapshot>(setup, "page_snapshots", "body");
  },
  ["page-snapshot"],
  { revalidate: PAGE_CACHE_SECONDS },
);

// The snapshot for a page, without the per-player details and live picks.
// cache() makes the header and the page share one load per request.
export const getSnapshot = cache(async (): Promise<LoadedSnapshot> => {
  const setup = supabaseSetup();
  if (setup) return { snapshot: await cachedPageSnapshot(setup.teamId), isDemo: false };
  const { file, isDemo } = await loadLocalFile();
  const { playerDetails, livePicks, ...snapshot } = file;
  void playerDetails; // deliberately dropped
  void livePicks; // only the Live page's API route needs these
  return { snapshot, isDemo };
});

// One part of the latest full snapshot (Supabase reads only that part), or of the local file.
async function snapshotPart<T>(key: "playerDetails" | "livePicks", path: string): Promise<T | null> {
  const setup = supabaseSetup();
  if (setup) return (await latest<T | null>(setup, "snapshots", `part:${path}`)) ?? null;
  const { file } = await loadLocalFile();
  const part = path.split("->").slice(2).reduce<unknown>((value, step) => (value as Record<string, unknown> | undefined)?.[step], file[key]);
  return (part as T | undefined) ?? null;
}

// Every team's picks for the week being played, or null if the sync hasn't saved any.
export async function getLivePicks(): Promise<LivePicks | null> {
  return snapshotPart<LivePicks>("livePicks", "body->livePicks");
}

// All players' detail entries, for the comparison page. Large, so only
// that page's server code calls it.
export async function getAllPlayerDetails(): Promise<Record<string, PlayerDetail>> {
  return (await snapshotPart<Record<string, PlayerDetail>>("playerDetails", "body->playerDetails")) ?? {};
}

// One player's detail entry for the panel, or null if the snapshot has no
// entry for him (for example, one written before the panel existed).
// Supabase's player_detail function reads just that entry: the web API
// would take a number in a path as a list position, not a player id.
export async function getPlayerDetail(playerId: number): Promise<PlayerDetail | null> {
  if (!Number.isInteger(playerId)) return null;
  const setup = supabaseSetup();
  if (!setup) return snapshotPart<PlayerDetail>("playerDetails", `body->playerDetails->${playerId}`);
  const { data, error } = await setup.supabase.rpc("player_detail", { team: setup.teamId, player: playerId });
  if (error) throw new Error(`Couldn't load player ${playerId} from Supabase: ${error.message}`);
  return (data as PlayerDetail | null) ?? null;
}
