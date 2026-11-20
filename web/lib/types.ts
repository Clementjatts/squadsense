// The shape of the snapshot the Python job writes. Keep this in sync with
// jobs/squadsense/snapshot.py. Prices are in tenths of a million (145 = £14.5m).

export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface Player {
  id: number;
  name: string;
  team: string;
  teamId: number;
  position: Position;
  price: number;
  sellingPrice: number;
  ownership: number;
  chance: number | null;
  news: string;
  yellowCards: number;
  netTransfersToday: number;
  xp: Record<string, number>;
  windowXp: number;
}

export interface Lineup {
  starters: number[];
  bench: number[];
  captain: number;
  vice_captain: number;
  expected_points: number;
}

export interface Suggestion {
  out: number;
  in: number;
  gain: number;
  bank_after: number;
  hit_cost: number;
  roll_value: number;
  net_gain: number;
  advice: "make" | "roll";
}

// One match in the Fixture Ticker. Difficulty runs from 1 (easiest) to 5
// (hardest), split into five equal groups across every match shown.
export interface TickerMatch {
  opponent: string;
  isHome: boolean;
  attackDifficulty: number;
  defenceDifficulty: number;
}

export interface TickerTeam {
  id: number;
  name: string;
  matches: Record<string, TickerMatch[]>; // by gameweek; empty means a blank
  // Expected goals ("attack") or clean sheets ("defence"), keyed by window length.
  scores: { attack: Record<string, number>; defence: Record<string, number> };
}

export interface FixtureTicker {
  weeks: number[];
  windows: number[];
  teams: TickerTeam[];
}

// One row of Price Watch, from FPL's own predictor. Progress past +100 or
// -100 means a rise or fall is expected at the next change (00:00 UK).
export interface PriceWatchRow {
  id: number;
  name: string;
  team: string;
  position: Position;
  price: number;
  ownership: number;
  netTransfers: number; // this gameweek
  progress: number;
  projected: number | null; // FPL's projection for the next change
  likelihood: number; // -5 (falling) to 5 (rising)
  prediction: string;
  lockedUntil: string | null;
  changedThisWeek: number;
  inSquad: boolean;
}

export interface PriceWatch {
  calibrating: boolean;
  atRisk: number[];
  rising: number[];
  players: PriceWatchRow[];
}

// Everything the player panel shows for one player. Loaded on demand from
// /api/players/[id], not sent with every page.
export interface PlayerDetail {
  id: number;
  name: string;
  fullName: string;
  team: string;
  teamName: string;
  position: Position;
  positionName: string;
  price: number;
  sellingPrice: number | null; // only for players in your squad
  ownership: number;
  chance: number | null;
  news: string;
  yellowCards: number;
  penaltyOrder: number | null;
  nextGameweek: number;
  xpNext: number;
  minutesPerMatch: number;
  xgPer90: number;
  xaPer90: number;
  recent: { gameweek: number; points: number; xg: number; xa: number; minutes: number }[];
  fixtures: { gameweek: number; opponent: string; isHome: boolean; difficulty: number }[];
  priceProgress: number;
  pricePrediction: string;
}

// One chip's card on the Chip Planner. gain is extra expected points.
export interface ChipCard {
  chip: "bboost" | "3xc" | "freehit" | "wildcard";
  label: string;
  status: "available" | "used";
  usedIn: number | null;
  bestWeek: number | null;
  gain: number | null;
  reason: string;
}

export interface ChipPlan {
  currentWeek: number;
  halfStart: number;
  halfStop: number;
  halfDeadline: string;
  weeksLeft: number;
  chipsLeft: number;
  cards: ChipCard[];
  timeline: { gameweek: number; used: string[]; recommended: string[] }[];
}

export interface Snapshot {
  generatedAt: string;
  modelVersion: string;
  team: { id: number; name: string; manager: string };
  gameweek: number;
  deadline: string;
  weeks: number[];
  bank: number;
  // null means unlimited: a team's first gameweek, before its first deadline.
  freeTransfers: number | null;
  squadValue: number;
  estimatedFromPublicData: boolean;
  squad: number[];
  // "model" when the real squad isn't public yet and the model picked one.
  squadSource: "fpl" | "model";
  players: Record<string, Player>;
  lineups: Record<string, Lineup>;
  captainOptions: { playerId: number; xp: number; safety: string; chance60: number }[];
  suggestions: Suggestion[];
  flags: { playerId: number; kind: "injury" | "suspension" | "rotation"; message: string }[];
  doubles: Record<string, string[]>;
  fixtureTicker: FixtureTicker;
  priceWatch: PriceWatch;
  chipPlan: ChipPlan;
  chipsUsed: { name: string; gameweek: number }[];
}
