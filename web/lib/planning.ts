// The planner's maths, run in the browser as you click. These mirror
// jobs/squadsense/planner.py and rules.py; if you change a rule in one,
// change it in the other.

import type { ChipCode, Player, Position, Snapshot } from "./types";

export const MAX_PER_CLUB = 3;
export const MAX_BANKED_FREE_TRANSFERS = 5;
export const POINTS_PER_EXTRA_TRANSFER = 4;
const WEEKLY_DISCOUNT = 0.9;

const MIN_STARTERS: Record<Position, number> = { GK: 1, DEF: 3, MID: 2, FWD: 1 };
const MAX_STARTERS: Record<Position, number> = { GK: 1, DEF: 5, MID: 5, FWD: 3 };

export interface PlannedMove {
  week: number;
  outId: number;
  inId: number;
}

// The chips the sandbox understands. Free Hit needs a one-week squad, which
// comes from the five-week plan (FreeHitSquads), so it's only offered in
// the week the plan picked one for.
export type PlannerChip = ChipCode;
export type PlannedChips = Partial<Record<number, PlannerChip>>; // gameweek -> chip
export type FreeHitSquads = Partial<Record<number, number[]>>; // gameweek -> the one-week squad
// Captains you chose (gameweek -> player). Weeks without one use the
// highest-xP starter, as planner.py does.
export type PlannedCaptains = Partial<Record<number, number>>;

export interface WeekPlan {
  week: number;
  chip: PlannerChip | null;
  freeHitSquad: number[] | null; // the one-week squad that plays in a Free Hit week
  squad: number[];
  starters: number[];
  bench: number[];
  captain: number;
  viceCaptain: number;
  captainChosen: boolean; // true when the captain is your pick, not the model's
  captainNotStarting: boolean; // you picked a captain who isn't in this week's best eleven
  expectedPoints: number;
  transfersMade: number;
  freeTransfersBefore: number | null;
  hitPoints: number;
  bankAfter: number;
  problems: string[];
}

function xpFor(player: Player, week: number): number {
  return player.xp[String(week)] ?? 0;
}

// Picks the best legal eleven for one week: fill each position's minimum
// first, then the highest remaining outfield players up to each maximum.
export function bestLineup(squad: number[], players: Record<string, Player>, week: number) {
  const byXp = [...squad].sort((a, b) => xpFor(players[b], week) - xpFor(players[a], week));
  const starters: number[] = [];
  const countIn = (position: Position) => starters.filter((id) => players[id].position === position).length;

  for (const position of Object.keys(MIN_STARTERS) as Position[]) {
    const best = byXp.filter((id) => players[id].position === position).slice(0, MIN_STARTERS[position]);
    starters.push(...best);
  }
  for (const id of byXp) {
    if (starters.length === 11) break;
    const position = players[id].position;
    if (!starters.includes(id) && position !== "GK" && countIn(position) < MAX_STARTERS[position]) {
      starters.push(id);
    }
  }

  const bench = byXp.filter((id) => !starters.includes(id)).sort((a, b) => {
    // Backup keeper always goes first on the bench, like on FPL.
    if (players[a].position === "GK") return -1;
    if (players[b].position === "GK") return 1;
    return 0;
  });
  // Captain and vice are the two highest-xP starters, as in planner.py.
  const [captain, viceCaptain] = [...starters].sort((a, b) => xpFor(players[b], week) - xpFor(players[a], week));
  const total = starters.reduce((sum, id) => sum + xpFor(players[id], week), 0) + xpFor(players[captain], week);
  return { starters, bench, captain, viceCaptain, expectedPoints: total };
}

// Swaps players in and out to get the squad for a given week.
function squadAfterMoves(startSquad: number[], moves: PlannedMove[]): number[] {
  return moves.reduce(
    (squad, move) => squad.map((id) => (id === move.outId ? move.inId : id)),
    startSquad,
  );
}

// Lists rule breaks for one week's squad in plain English.
function checkRules(squad: number[], players: Record<string, Player>, bank: number): string[] {
  const problems: string[] = [];
  if (bank < 0) problems.push(`Over budget by £${(-bank / 10).toFixed(1)}m`);
  for (const [club, count] of Object.entries(clubsOverLimit(squad.map((id) => players[id].team)))) {
    problems.push(`${count} players from ${club}, the limit is ${MAX_PER_CLUB}`);
  }
  return problems;
}

// The three rules below mirror rules.py (hit_points, next_free_transfers,
// clubs_over_limit). shared/rule-cases.json holds cases both test suites check.

const UNLIMITED_TRANSFER_CHIPS: (PlannerChip | null)[] = ["wildcard", "freehit"];

/** Points taken off for transfers beyond the free ones. null free transfers (a team's first week), Wildcard and Free Hit weeks are unlimited. */
export function hitPoints(transfersMade: number, freeTransfers: number | null, chip: PlannerChip | null): number {
  if (freeTransfers === null || UNLIMITED_TRANSFER_CHIPS.includes(chip)) return 0;
  return Math.max(0, transfersMade - freeTransfers) * POINTS_PER_EXTRA_TRANSFER;
}

/**
 * Free transfers for the following week. After an unlimited week you have 1.
 * A Wildcard or Free Hit week keeps the banked ones and still adds one (the
 * same assumption as squad_state.py). Otherwise unused ones carry over, plus
 * one, up to MAX_BANKED_FREE_TRANSFERS.
 */
export function nextFreeTransfers(freeTransfers: number | null, transfersMade: number, chip: PlannerChip | null): number {
  if (freeTransfers === null) return 1;
  const banked = UNLIMITED_TRANSFER_CHIPS.includes(chip) ? freeTransfers + 1 : Math.max(0, freeTransfers - transfersMade) + 1;
  return Math.min(MAX_BANKED_FREE_TRANSFERS, banked);
}

/** Each club with more than MAX_PER_CLUB players in `clubs`, with its count. */
export function clubsOverLimit(clubs: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const club of clubs) counts[club] = (counts[club] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > MAX_PER_CLUB));
}

// Replays the plan week by week: squad, bank, free transfers, hits and xP.
// Selling a player you bought earlier in the plan gives back what you paid,
// which is right as long as his price hasn't moved in between.
// A chip's extra xP on top of the normal lineup: the bench for Bench Boost,
// the captain once more for Triple Captain, nothing for Wildcard.
function chipBonus(chip: PlannerChip | null, lineup: ReturnType<typeof bestLineup>, players: Record<string, Player>, week: number): number {
  if (chip === "bboost") return lineup.bench.reduce((sum, id) => sum + xpFor(players[id], week), 0);
  if (chip === "3xc") return xpFor(players[lineup.captain], week);
  return 0;
}

// Puts your chosen captain on the armband, if he starts this week, and
// makes the model's captain the vice. Expected points change by the
// difference between the two captains, since the captain's points count twice.
function withChosenCaptain(lineup: ReturnType<typeof bestLineup>, chosen: number | undefined, players: Record<string, Player>, week: number) {
  if (chosen === undefined || chosen === lineup.captain || !lineup.starters.includes(chosen)) return lineup;
  const expectedPoints = lineup.expectedPoints - xpFor(players[lineup.captain], week) + xpFor(players[chosen], week);
  return { ...lineup, captain: chosen, viceCaptain: lineup.captain, expectedPoints };
}

export function simulatePlan(
  snapshot: Snapshot,
  moves: PlannedMove[],
  chips: PlannedChips = {},
  freeHitSquads: FreeHitSquads = {},
  captains: PlannedCaptains = {},
): WeekPlan[] {
  const { players } = snapshot;
  const paidInPlan = new Map<number, number>();
  let squad = snapshot.squad;
  let bank = snapshot.bank;
  let freeTransfers = snapshot.freeTransfers;
  const plans: WeekPlan[] = [];

  for (const week of snapshot.weeks) {
    const weekMoves = moves.filter((move) => move.week === week);
    for (const move of weekMoves) {
      const sellFor = paidInPlan.get(move.outId) ?? players[move.outId].sellingPrice;
      bank += sellFor - players[move.inId].price;
      paidInPlan.set(move.inId, players[move.inId].price);
    }
    squad = squadAfterMoves(squad, weekMoves);

    const transfersMade = weekMoves.length;
    const chip = chips[week] ?? null;
    const freeHitSquad = chip === "freehit" ? freeHitSquads[week] : undefined;
    const weekHitPoints = hitPoints(transfersMade, freeTransfers, chip);
    // In a Free Hit week the one-week squad plays; your own squad sits it out unchanged.
    const chosenCaptain = captains[week];
    const lineup = withChosenCaptain(bestLineup(freeHitSquad ?? squad, players, week), chosenCaptain, players, week);
    const problems = checkRules(squad, players, bank);
    if (freeHitSquad && transfersMade > 0) problems.push("Free Hit week: plan your own transfers for another week");

    plans.push({
      week,
      chip,
      freeHitSquad: freeHitSquad ?? null,
      squad,
      starters: lineup.starters,
      bench: lineup.bench,
      captain: lineup.captain,
      viceCaptain: lineup.viceCaptain,
      captainChosen: chosenCaptain !== undefined && lineup.captain === chosenCaptain,
      captainNotStarting: chosenCaptain !== undefined && lineup.captain !== chosenCaptain,
      expectedPoints: lineup.expectedPoints + chipBonus(chip, lineup, players, week),
      transfersMade,
      freeTransfersBefore: freeTransfers,
      hitPoints: weekHitPoints,
      bankAfter: bank,
      problems,
    });
    freeTransfers = nextFreeTransfers(freeTransfers, transfersMade, chip);
  }
  return plans;
}

// Total xP for a plan, later weeks discounted and hits taken off.
export function planScore(plans: WeekPlan[]): number {
  return plans.reduce(
    (sum, plan, offset) => sum + WEEKLY_DISCOUNT ** offset * plan.expectedPoints - plan.hitPoints,
    0,
  );
}

// Players who could replace `outId`: same position, not already in the
// squad, best first over the planning window.
export function replacementOptions(snapshot: Snapshot, squad: number[], outId: number): Player[] {
  const outPlayer = snapshot.players[outId];
  return Object.values(snapshot.players)
    .filter((player) => player.position === outPlayer.position && !squad.includes(player.id))
    .sort((a, b) => b.windowXp - a.windowXp);
}

// What a link from the player panel asks the Planner to do: ?buy=, ?sell=
// or ?captain= with a player id.
export type PlannerRequest = { kind: "buy" | "sell" | "captain"; playerId: number };

// Reads that request from the address. A buy of a player you already own
// becomes a sell, and a sell or captain of someone you don't own is
// ignored, since the Planner can't act on it.
export function plannerRequest(search: string, snapshot: Snapshot): PlannerRequest | null {
  const params = new URLSearchParams(search);
  for (const kind of ["buy", "sell", "captain"] as const) {
    const playerId = Number(params.get(kind));
    if (!params.has(kind) || !snapshot.players[playerId]) continue;
    const owned = snapshot.squad.includes(playerId);
    if (kind === "buy") return { kind: owned ? "sell" : "buy", playerId };
    return owned ? { kind, playerId } : null;
  }
  return null;
}
