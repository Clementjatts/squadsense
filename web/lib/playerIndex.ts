// The player list behind search and the comparison picker, loaded once
// per page visit from /api/players and shared by every caller.

"use client";

import { useEffect, useState } from "react";
import type { Position } from "./types";

export interface IndexedPlayer {
  id: number;
  name: string;
  fullName: string;
  team: string;
  position: Position;
  price: number;
}

let indexRequest: Promise<IndexedPlayer[]> | null = null;

// Starts the request the first time it's needed and reuses it after that.
// A failed request is forgotten so the next call can try again.
function loadIndex(): Promise<IndexedPlayer[]> {
  if (!indexRequest) {
    indexRequest = fetch("/api/players").then(async (response) => {
      if (!response.ok) throw new Error(`Player list failed with status ${response.status}`);
      return (await response.json()) as IndexedPlayer[];
    });
    indexRequest.catch(() => {
      indexRequest = null;
    });
  }
  return indexRequest;
}

/** The player list once `enabled` is true, plus any error loading it. */
export function usePlayerIndex(enabled: boolean): { players: IndexedPlayer[]; error: string | null } {
  const [players, setPlayers] = useState<IndexedPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadIndex()
      .then((loaded) => !cancelled && setPlayers(loaded))
      .catch((loadError: Error) => !cancelled && setError(loadError.message));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { players, error };
}

// Ignores case and accents, so "odegaard" finds "Ødegaard".
function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/gi, "o").toLowerCase();
}

/** Players whose name, full name or club starts a word with the query, best known names first. */
export function searchPlayers(players: IndexedPlayer[], query: string, limit = 8): IndexedPlayer[] {
  const wanted = normalise(query.trim());
  if (!wanted) return [];
  const matches = players.filter((player) =>
    [player.name, player.fullName, player.team].some((text) => normalise(text).split(/[\s.-]+/).some((word) => word.startsWith(wanted)))
    || normalise(player.name).startsWith(wanted),
  );
  return matches.slice(0, limit);
}
