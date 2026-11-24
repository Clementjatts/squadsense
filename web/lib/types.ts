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
  form: number[]; // points in each of his club's last six gameweeks, oldest first
  setPieces: SetPieces;
  fplXp: number | null; // FPL's own expected points for next week (ep_next)
}

/** His place in his club's order for each set piece; 1 is first choice, null means not listed. */
export interface SetPieces {
  penalties: number | null;
  corners: number | null;
  freeKicks: number | null;
}

export interface Lineup {
  starters: number[];
  bench: number[];
  captain: number;
  vice_captain: number;
  expected_points: number;
}

// The multi-week transfer plan from the solver: one entry per gameweek.
export interface SolverWeek {
  gameweek: number;
  // value: five-week xP lost if only this move were undone; priceNote: tonight's likely price change, if it matters
  // sameWeekShare / anyWeekShare: share of noisy re-solves that made this move that week / in any week
  moves: { out: number; in: number; value: number; priceNote?: string | null; sameWeekShare?: number; anyWeekShare?: number }[];
  squad: number[]; // your own squad after this week's moves
  freeHitSquad: number[] | null; // the one-week squad in a Free Hit week
  hits: number;
  freeTransfers: number | null; // before this week's moves; null means unlimited
  bank: number; // after this week's moves
  captain: number;
  chip: ChipCode | null;
  xp: number; // lineup xP with the chip, captain counted twice (three times with Triple Captain)
}

export interface SolverPlan {
  weeks: SolverWeek[];
  totalHits: number;
  chips: Partial<Record<ChipCode, number>>;
  gain: number; // discounted xP after hits, compared with no moves and no chips
  finishedSearch: boolean; // false if the time limit came before the solver proved the plan
  normalTransfers: { weeks: SolverWeek[]; gain: number; totalHits: number }; // the best plan with no chips
  gapToBest: number; // how far your squad is from the best squad over the window
  normalShareOfGap: number; // share of that gap normal transfers close
  wildcardMargin: number;
  closeCallPoints: number;
  // How sure: the plan re-solved `runs` times with random noise on xP, and the
  // first-week moves those runs chose instead of the plan's.
  sensitivity?: { runs: number; firstWeekAlternatives: { out: number; in: number; share: number }[] };
  // The best one-week squad for each week Free Hit could be played (gameweek -> 15 ids).
  // Missing in plans made before 22 November 2026.
  freeHitSquads?: Record<string, number[]>;
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
  priceNote: string | null; // set when tonight's price change makes it worth moving before 00:00
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
  fplXp: number | null; // FPL's own expected points for next week
  season: SeasonTotals;
  pastSeasons: { season: string; points: number; minutes: number; xg: number; xa: number }[]; // newest first
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

// A player's totals so far this season.
export interface SeasonTotals {
  points: number;
  minutes: number;
  starts: number;
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  cleanSheets: number;
  bonus: number;
  defensiveContribution: number;
  saves: number;
}

// One chip's card on the Chip Planner. gain is extra expected points.
export type ChipCode = "bboost" | "3xc" | "freehit" | "wildcard";

// The one chip strategy's decision for a chip (jobs/squadsense/strategy.py). Every page shows this.
export interface ChipDecision {
  action: "play" | "save" | "none";
  week: number | null; // the week it's played (play) or saved for (save)
  gain: number | null; // xP it adds that week, measured against normal transfers
  playNow: boolean;
  closeCall: boolean; // within a couple of points of saving it: your call
  keepValue: number | null; // the value of saving it, as the plan counted it
  laterWeek: number | null; // its best week after the five-week window
  laterGain: number | null;
}

export interface ChipCard {
  chip: ChipCode;
  label: string;
  status: "available" | "used";
  usedIn: number | null;
  decision: ChipDecision | null; // null once used
  source: "plan" | "estimate"; // "estimate" when there's no transfer plan to decide with
  reason: string;
  // allBenchPlay (Bench Boost), haulChance/blankChance/captainId (Triple Captain), changes (Wildcard)
  risk: { allBenchPlay?: number; haulChance?: number; blankChance?: number; captainId?: number; changes?: number };
  quality: "near" | "far" | null; // "far" weeks lean on fixtures more than form
  byWeek: { gameweek: number; gain: number }[]; // value in each week, against normal transfers
}

export interface RivalChips {
  id: number;
  name: string;
  rivals: number;
  holding: Record<ChipCode, number>; // how many rivals still have each chip
  rows: { entry: number; teamName: string; rank: number; total: number; chipsLeft: ChipCode[] }[];
}

export interface FixtureWarnings {
  unscheduled: string[]; // postponed matches with no gameweek yet
  provisional: { gameweek: number; match: string }[];
  weeks: { gameweek: number; blanks: string[]; doubles: string[] }[];
}

export interface ChipPlan {
  currentWeek: number;
  halfStart: number;
  halfStop: number;
  halfDeadline: string;
  weeksLeft: number;
  chipsLeft: number;
  cards: ChipCard[];
  source: "plan" | "estimate";
  timeline: { gameweek: number; used: string[]; recommended: string[]; saved: string[]; quality: "near" | "far" | null }[];
  fixtureWarnings: FixtureWarnings;
  rivals: RivalChips[];
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
  // haulChance: chance of 10+ points of his own; blankChance: 2 or fewer. Both from a simulation.
  captainOptions: { playerId: number; xp: number; safety: string; chance60: number; haulChance: number; blankChance: number }[];
  suggestions: Suggestion[];
  solverPlan: SolverPlan | null; // null for a squad the model picked
  leagues: League[];
  review: GameweekReview | null;
  changes?: { at: string; changes: string[] }[]; // the "What changed" feed, newest first
  ruleChanges?: string[]; // FPL rules that differ from the typed-in ones in jobs/squadsense/rules.py
  // Moves marked "Done on FPL" that this snapshot's squad already includes, and
  // marks from the last deadline that FPL's real squad didn't have.
  madeMoves?: { gameweek: number; out: number; in: number; priceIn: number }[];
  madeMoveMismatches?: { gameweek: number; out: number; in: number; priceIn: number }[];

  flags: { playerId: number; kind: "injury" | "suspension" | "rotation"; message: string }[];
  doubles: Record<string, string[]>;
  fixtureTicker: FixtureTicker;
  priceWatch: PriceWatch;
  chipPlan: ChipPlan;
  chipsUsed: { name: string; gameweek: number }[];
}

// Mini-leagues. Shares are the fraction of rivals (not counting you) who own or captain him.
export interface LeaguePlayerLine {
  playerId: number;
  share: number;
  captainShare: number;
  xp: number; // next gameweek
}

export interface LeagueRow {
  entry: number;
  teamName: string;
  manager: string;
  rank: number; // tied teams share a rank, so ranks can skip (11, 11, 13)
  position?: number; // FPL's rank_sort: counts on without gaps; missing before 22 November 2026
  lastRank: number;
  total: number;
  eventPoints: number;
  chip: string | null;
  captain: number | null;
  chipsLeft: ChipCode[] | null;
}

// "full": every rival's picks were read (leagues of up to 100 teams).
// "table": a bigger league with only its top 50 and the 50 around you, and
// no threats, differentials or captains.
export interface League {
  id: number;
  name: string;
  kind?: "full" | "table"; // missing in snapshots saved before 22 November 2026
  size: number; // teams in the whole league, not just the rows in `table`
  rivalsWithPicks: number;
  myRank: number | null;
  myLastRank: number | null;
  table: LeagueRow[];
  mySquad: LeaguePlayerLine[];
  threats: LeaguePlayerLine[];
  differentials: LeaguePlayerLine[];
  topCaptains: LeaguePlayerLine[];
}

// The review of the last finished gameweek. `team` is null if your team hadn't started yet.
export interface GameweekReview {
  gameweek: number;
  average: number | null;
  highest: number | null;
  mostCaptained: { playerId: number; points: number } | null;
  topPlayers: { playerId: number; points: number }[];
  team: {
    points: number;
    transferCost: number;
    benchPoints: number;
    overallRank: number;
    previousRank: number | null;
    chip: string | null;
    captain: { playerId: number; points: number };
    bestCaptain: { playerId: number; points: number };
    predictedTotal: number | null;
    starters: { playerId: number; points: number; xp: number | null }[];
  } | null;
  season?: SeasonReview | null; // missing in snapshots saved before 22 November 2026
}

// One finished week of your season. `points` are after hits. `captainLost`
// is the captain points you'd have gained with the best pick in your
// eleven (0 when you picked him), or null when your picks weren't read.
export interface SeasonWeek {
  gameweek: number;
  points: number;
  average: number | null;
  overallRank: number;
  benchPoints: number;
  transferCost: number;
  predicted: number | null; // the forecast total saved before the deadline
  captainLost: number | null;
}

export interface SeasonReview {
  weeks: SeasonWeek[];
  totals: {
    weeks: number;
    points: number;
    benchPoints: number;
    transferCost: number;
    aboveAverage: number;
    captainWeeks: number;
    captainRight: number;
    captainLost: number;
    forecastWeeks: number;
    forecastPredicted: number;
    forecastActual: number;
  };
}

// Every team's picks for the gameweek being played, for the Live page.
export interface LivePick {
  element: number;
  position: number; // 1-11 start, 12-15 bench in order
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface LiveTeamPicks {
  picks: LivePick[];
  active_chip: string | null;
  hits: number; // points spent on extra transfers this week
}

export interface LivePicks {
  gameweek: number;
  elements: Record<string, [number, number, string?]>; // player id -> [club id, position 1-4, short name (missing before 22 November 2026)]
  mine: LiveTeamPicks | null;
  leagues: { id: number; name: string; teams: { entry: number; teamName: string; totalBefore: number; picks: LivePick[]; chip: string | null }[] }[];
}
