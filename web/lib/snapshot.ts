// Loads the latest snapshot for the team. Runs on the server only, so the
// Supabase service key never reaches the browser.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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

// Finds the latest snapshot: Supabase when it's set up, local files otherwise.
async function loadFile(): Promise<LoadedFile> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const teamId = Number(process.env.FPL_TEAM_ID);

  if (!url || !serviceKey) {
    return loadLocalFile();
  }
  if (!teamId) {
    throw new Error("FPL_TEAM_ID is missing or not a number. Check .env.local.");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("snapshots")
    .select("body")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't load the snapshot from Supabase: ${error.message}`);
  }
  if (!data) {
    throw new Error(`No snapshot yet for team ${teamId}. Run the sync job first.`);
  }
  return { file: data.body as SnapshotFile, isDemo: false };
}

// The snapshot for a page, with the per-player details left out so pages
// stay small.
export async function getSnapshot(): Promise<LoadedSnapshot> {
  const { file, isDemo } = await loadFile();
  const { playerDetails, livePicks, ...snapshot } = file;
  void playerDetails; // deliberately dropped
  void livePicks; // only the Live page's API route needs these
  return { snapshot, isDemo };
}

// Every team's picks for the week being played, or null if the sync hasn't saved any.
export async function getLivePicks(): Promise<LivePicks | null> {
  const { file } = await loadFile();
  return file.livePicks ?? null;
}

// All players' detail entries, for the comparison page. Large, so only
// that page's server code calls it.
export async function getAllPlayerDetails(): Promise<Record<string, PlayerDetail>> {
  const { file } = await loadFile();
  return file.playerDetails ?? {};
}

// One player's detail entry for the panel, or null if the snapshot has no
// entry for him (for example, one written before the panel existed).
export async function getPlayerDetail(playerId: number): Promise<PlayerDetail | null> {
  const { file } = await loadFile();
  return file.playerDetails?.[String(playerId)] ?? null;
}
