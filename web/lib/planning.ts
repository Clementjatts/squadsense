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
// weeks the plan built one for.
export type PlannerChip = ChipCode;
export type PlannedChips = Partial<Record<number, PlannerChip>>; // gameweek -> chip
export type FreeHitSquads = Partial<Record<number, number[]>>; // gameweek -> the one-week squad
// Captains you chose (gameweek -> player). Weeks without one use the
// highest-xP starter, as planner.py does.
export type PlannedCaptains = Partial<Record<number, number>>;

// A lineup you picked yourself for one week: eleven starters, the bench
// in order (backup keeper first), captain and vice-captain. Weeks without
// one use the model's best eleven.
export interface LineupChoice {
  starters: number[];
  bench: number[];
  captain: number;
  viceCaptain: number;
}
export type PlannedLineups = Partial<Record<number, LineupChoice>>; // gameweek -> your lineup

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
  lineupChosen: boolean; // true when the eleven is one you picked, not the model's
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

/** True if eleven players in these positions make a legal FPL formation. Mirrors rules.is_valid_formation. */
export function isValidFormation(positions: Position[]): boolean {
  if (positions.length !== 11) return false;
  return (Object.keys(MIN_STARTERS) as Position[]).every((position) => {
    const count = positions.filter((each) => each === position).length;
    return count >= MIN_STARTERS[position] && count <= MAX_STARTERS[position];
  });
}

/** A chosen lineup's expected points: every starter once, plus the captain once more. */
export function lineupScore(choice: LineupChoice, players: Record<string, Player>, week: number): number {
  return choice.starters.reduce((sum, id) => sum + xpFor(players[id], week), 0) + xpFor(players[choice.captain], week);
}

/** True when a chosen lineup uses exactly this 15-man squad, with a legal eleven and two different armbands. */
export function choiceFitsSquad(choice: LineupChoice, squad: number[], players: Record<string, Player>): boolean {
  const chosen = [...choice.starters, ...choice.bench];
  return (
    choice.starters.length === 11 && choice.bench.length === 4 && chosen.length === squad.length
    && chosen.every((id) => squad.includes(id))
    && isValidFormation(choice.starters.map((id) => players[id].position))
    && choice.starters.includes(choice.captain) && choice.starters.includes(choice.viceCaptain)
    && choice.captain !== choice.viceCaptain
  );
}

/**
 * Carries a chosen lineup through planned transfers: each player sold
 * hands his slot (and armband) to the player bought for him. Transfers are
 * always like for like by position, so the formation stays the same.
 */
export function carryChoiceThroughMoves(choice: LineupChoice, moves: PlannedMove[]): LineupChoice {
  const replace = (id: number) => moves.reduce((current, move) => (current === move.outId ? move.inId : current), id);
  return {
    starters: choice.starters.map(replace),
    bench: choice.bench.map(replace),
    captain: replace(choice.captain),
    viceCaptain: replace(choice.viceCaptain),
  };
}

// The highest-xP starter other than `except`, for handing on an armband.
function bestStarterExcept(starters: number[], except: number[], players: Record<string, Player>, week: number): number {
  return [...starters].filter((id) => !except.includes(id)).sort((a, b) => xpFor(players[b], week) - xpFor(players[a], week))[0];
}

/**
 * Swaps two players the way FPL's "Pick Team" screen does, or explains why
 * it can't. A starter and a bench player change places (keepers only with
 * keepers, and the eleven must stay a legal formation); two outfield bench
 * players change bench order. The backup keeper always stays first on the
 * bench. A captain or vice moved to the bench hands the armband on.
 */
export function swapInLineup(choice: LineupChoice, first: number, second: number, players: Record<string, Player>, week: number): LineupChoice | string {
  const isKeeper = (id: number) => players[id].position === "GK";
  const starting = (id: number) => choice.starters.includes(id);
  if (first === second) return "Pick two different players.";
  if (starting(first) && starting(second)) return "Both already start. Pick a bench player to bring one off.";
  if (!starting(first) && !starting(second)) {
    if (isKeeper(first) || isKeeper(second)) return "The backup keeper always sits first on the bench.";
    const bench = choice.bench.map((id) => (id === first ? second : id === second ? first : id));
    return { ...choice, bench };
  }
  const [starter, benched] = starting(first) ? [first, second] : [second, first];
  if (isKeeper(starter) !== isKeeper(benched)) return "Keepers can only swap with keepers.";
  const starters = choice.starters.map((id) => (id === starter ? benched : id));
  if (!isValidFormation(starters.map((id) => players[id].position))) {
    return `That breaks the formation: you need at least 3 defenders, 2 midfielders and 1 forward.`;
  }
  const bench = choice.bench.map((id) => (id === benched ? starter : id));
  let { captain, viceCaptain } = choice;
  if (captain === starter) captain = viceCaptain === starter ? bestStarterExcept(starters, [], players, week) : viceCaptain;
  if (viceCaptain === starter || viceCaptain === captain) viceCaptain = bestStarterExcept(starters, [captain], players, week);
  return { starters, bench, captain, viceCaptain };
}

/** Puts the armband (or the vice armband) on a starter. Picking the other armband's holder swaps the two. */
export function setArmband(choice: LineupChoice, id: number, role: "captain" | "vice"): LineupChoice | string {
  if (!choice.starters.includes(id)) return "Only a starter can wear an armband.";
  if (role === "captain") {
    return { ...choice, captain: id, viceCaptain: choice.viceCaptain === id ? choice.captain : choice.viceCaptain };
  }
  return { ...choice, viceCaptain: id, captain: choice.captain === id ? choice.viceCaptain : choice.captain };
}

// Your chosen lineup for one week, carried through the moves planned up to
// then, or null when there's none or it no longer fits the squad that plays.
function weekLineup(choice: LineupChoice | undefined, playing: number[], movesSoFar: PlannedMove[], players: Record<string, Player>): LineupChoice | null {
  if (!choice) return null;
  const carried = carryChoiceThroughMoves(choice, movesSoFar);
  return choiceFitsSquad(carried, playing, players) ? carried : null;
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
  lineups: PlannedLineups = {},
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
    const playing = freeHitSquad ?? squad;
    const chosenLineup = weekLineup(lineups[week], playing, moves.filter((move) => move.week <= week), players);
    const baseLineup = chosenLineup ? { ...chosenLineup, expectedPoints: lineupScore(chosenLineup, players, week) } : bestLineup(playing, players, week);
    const chosenCaptain = captains[week];
    const lineup = withChosenCaptain(baseLineup, chosenCaptain, players, week);
    const problems = checkRules(squad, players, bank);
    if (freeHitSquad && transfersMade > 0) problems.push("Free Hit week: plan your own transfers for another week");
    if (lineups[week] && !chosenLineup) problems.push(`Your GW${week} lineup no longer fits this squad, so the best eleven is used`);

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
      lineupChosen: chosenLineup !== null,
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
