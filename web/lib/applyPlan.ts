// Turns one planned gameweek into the exact requests FPL expects, and
// checks them against your team as FPL has it right now. No network
// calls here, so it can be tested on its own.
//
// Transfers go to /api/transfers/ with each player's real selling price
// (from FPL) and today's buying price. Wildcard and Free Hit ride along
// on the transfers request. The lineup goes to /api/my-team/{id}/, and
// Bench Boost or Triple Captain ride along on that one.

import type { MyTeam } from "./fplAccount";

export type ApplyChip = "wildcard" | "freehit" | "bboost" | "3xc" | null;

export interface ApplyRequest {
  gameweek: number;
  moves: { outId: number; inId: number }[];
  starters: number[];
  bench: number[]; // in substitution order, backup keeper first
  captain: number;
  viceCaptain: number;
  chip: ApplyChip;
}

export interface PlayerFacts {
  id: number;
  name: string;
  position: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  nowCost: number;
}

export interface ApplyPreview {
  problems: string[]; // anything here blocks applying
  transferPayload: Record<string, unknown> | null; // null when there are no transfers and no transfer chip
  lineupPayload: Record<string, unknown>;
  bankAfter: number;
  hitCost: number;
  lines: string[]; // plain-English summary of everything that will change
}

const TRANSFER_CHIPS = new Set(["wildcard", "freehit"]);
const LINEUP_CHIPS = new Set(["bboost", "3xc"]);
const CHIP_LABELS: Record<string, string> = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };

/** Checks the request against FPL's own view of your team, then builds both payloads. */
export function previewApply(request: ApplyRequest, myTeam: MyTeam, teamId: number, players: Map<number, PlayerFacts>): ApplyPreview {
  const problems: string[] = [];
  const owned = new Map(myTeam.picks.map((pick) => [pick.element, pick]));
  const name = (id: number) => players.get(id)?.name ?? `player ${id}`;

  for (const move of request.moves) {
    if (!owned.has(move.outId)) problems.push(`${name(move.outId)} isn't in your FPL squad any more. Run the sync and plan again.`);
    if (owned.has(move.inId)) problems.push(`${name(move.inId)} is already in your FPL squad.`);
    if (players.get(move.outId)?.position !== players.get(move.inId)?.position) problems.push(`${name(move.outId)} and ${name(move.inId)} play different positions.`);
  }

  const squadAfter = new Set([...owned.keys()].filter((id) => !request.moves.some((move) => move.outId === id)));
  request.moves.forEach((move) => squadAfter.add(move.inId));
  const lineupIds = [...request.starters, ...request.bench];
  if (lineupIds.length !== 15 || new Set(lineupIds).size !== 15 || lineupIds.some((id) => !squadAfter.has(id))) {
    problems.push("The lineup doesn't match the squad after these transfers.");
  }
  if (!request.starters.includes(request.captain) || !request.starters.includes(request.viceCaptain) || request.captain === request.viceCaptain) {
    problems.push("Captain and vice-captain must be two different starters.");
  }
  if (request.chip && !myTeam.chips.some((chip) => chip.name === request.chip && chip.status_for_entry === "available")) {
    problems.push(`FPL says ${CHIP_LABELS[request.chip]} isn't available to play now.`);
  }

  const priced = request.moves.map((move) => ({
    element_out: move.outId,
    selling_price: owned.get(move.outId)?.selling_price ?? 0,
    element_in: move.inId,
    purchase_price: players.get(move.inId)?.nowCost ?? 0,
  }));
  const bankAfter = myTeam.transfers.bank + priced.reduce((sum, item) => sum + item.selling_price - item.purchase_price, 0);
  if (bankAfter < 0) problems.push(`Not enough money: the bank would be £${(bankAfter / 10).toFixed(1)}m.`);

  const unlimited = request.chip === "wildcard" || request.chip === "freehit" || myTeam.transfers.limit === null;
  const freeLeft = Math.max(0, (myTeam.transfers.limit ?? 0) - myTeam.transfers.made);
  const hitCost = unlimited ? 0 : Math.max(0, request.moves.length - freeLeft) * 4;

  const transferChip = request.chip && TRANSFER_CHIPS.has(request.chip) ? request.chip : null;
  const transferPayload = priced.length > 0 || transferChip
    ? {
        confirmed: false,
        entry: teamId,
        event: request.gameweek,
        transfers: priced.sort((a, b) => (players.get(a.element_in)?.position ?? 0) - (players.get(b.element_in)?.position ?? 0)),
        wildcard: transferChip === "wildcard",
        freehit: transferChip === "freehit",
      }
    : null;

  const lineupPayload = {
    chip: request.chip && LINEUP_CHIPS.has(request.chip) ? request.chip : null,
    picks: lineupPicks(request, players),
  };

  const lines = [
    ...request.moves.map((move) => {
      const sell = owned.get(move.outId)?.selling_price ?? 0;
      return `Sell ${name(move.outId)} for £${(sell / 10).toFixed(1)}m, buy ${name(move.inId)} for £${((players.get(move.inId)?.nowCost ?? 0) / 10).toFixed(1)}m`;
    }),
    `Captain ${name(request.captain)}, vice-captain ${name(request.viceCaptain)}`,
    `Bench in order: ${request.bench.map(name).join(", ")}`,
    ...(request.chip ? [`Play ${CHIP_LABELS[request.chip]}`] : []),
    ...(hitCost > 0 ? [`Points hit: -${hitCost}`] : []),
  ];
  return { problems, transferPayload, lineupPayload, bankAfter, hitCost, lines };
}

// FPL wants starters in positions 1-11 ordered keeper, defenders, midfielders,
// forwards, then the bench as 12 (backup keeper) to 15 in substitution order.
function lineupPicks(request: ApplyRequest, players: Map<number, PlayerFacts>) {
  const starters = [...request.starters].sort((a, b) => (players.get(a)?.position ?? 0) - (players.get(b)?.position ?? 0));
  const keeperFirst = [...request.bench].sort((a, b) => Number(players.get(b)?.position === 1) - Number(players.get(a)?.position === 1));
  return [...starters, ...keeperFirst].map((element, index) => ({
    element,
    position: index + 1,
    is_captain: element === request.captain,
    is_vice_captain: element === request.viceCaptain,
  }));
}
