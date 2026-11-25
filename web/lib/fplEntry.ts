// Looks up an FPL team by its id on FPL's public API, so sign-up can show
// "Team: X, manager Y" and refuse ids that don't exist. Server only.

import "server-only";

export interface FplTeam {
  teamName: string;
  manager: string;
}

const LOOKUP_CACHE_SECONDS = 300;

/** The team's name and manager, or null when FPL has no team with that id. Throws when FPL can't be reached. */
export async function lookUpFplTeam(teamId: number): Promise<FplTeam | null> {
  const response = await fetch(`https://fantasy.premierleague.com/api/entry/${teamId}/`, { next: { revalidate: LOOKUP_CACHE_SECONDS } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FPL didn't answer the team lookup (HTTP ${response.status}). Try again in a minute.`);
  const entry = (await response.json()) as { name?: string; player_first_name?: string; player_last_name?: string };
  if (!entry.name) return null;
  return { teamName: entry.name, manager: [entry.player_first_name, entry.player_last_name].filter(Boolean).join(" ") };
}
