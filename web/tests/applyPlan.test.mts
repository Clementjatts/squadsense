// Checks for lib/applyPlan.ts with a made-up FPL team: prices, bank, hits,
// chips, lineup order and the problems that must block applying.
// Run with: npm test

import { previewApply } from "../lib/applyPlan.ts";
const positions = [1,1,2,2,2,2,2,3,3,3,3,3,4,4,4];
const players = new Map(); for (let id = 1; id <= 20; id++) players.set(id, { id, name: `P${id}`, position: id <= 15 ? positions[id-1] : positions[id-16+7], nowCost: 50 + id });
// Players 16-20 are extra midfielders to buy.
const myTeam = { picks: Array.from({length: 15}, (_, i) => ({ element: i+1, position: i+1, selling_price: 50, purchase_price: 50, is_captain: false, is_vice_captain: false })),
  chips: [{ name: "wildcard", status_for_entry: "available" }, { name: "bboost", status_for_entry: "played" }], transfers: { bank: 40, limit: 1, made: 0, cost: 4 } };
const base = { gameweek: 12, moves: [{ outId: 8, inId: 16 }], starters: [1,3,4,5,6,16,9,10,11,13,14], bench: [12,2,7,15], captain: 13, viceCaptain: 14, chip: null };
const ok = previewApply(base, myTeam, 99, players);
// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => { console.log(cond ? "PASS" : "FAIL", label); if (!cond) process.exitCode = 1; };
check("valid plan has no problems", ok.problems.length === 0);
check("selling price from FPL, buying price now", JSON.stringify(ok.transferPayload.transfers[0]) === JSON.stringify({ element_out: 8, selling_price: 50, element_in: 16, purchase_price: 66 }));
check("bank after", ok.bankAfter === 40 + 50 - 66 && ok.problems.length === 0);
check("one free transfer, no hit", ok.hitCost === 0);
check("keeper first on bench at position 12", ok.lineupPayload.picks[11].element === 2 && ok.lineupPayload.picks[11].position === 12);
check("starter keeper at position 1", ok.lineupPayload.picks[0].element === 1);
const two = previewApply({ ...base, moves: [{ outId: 8, inId: 16 }, { outId: 9, inId: 17 }], starters: [1,3,4,5,6,16,17,10,11,13,14] }, myTeam, 99, players);
check("second transfer costs 4", two.hitCost === 4);
const wc = previewApply({ ...base, moves: [{ outId: 8, inId: 16 }, { outId: 9, inId: 17 }], starters: [1,3,4,5,6,16,17,10,11,13,14], chip: "wildcard" }, myTeam, 99, players);
check("wildcard: no hit, flag set", wc.hitCost === 0 && wc.transferPayload.wildcard === true);
const used = previewApply({ ...base, chip: "bboost" }, myTeam, 99, players);
check("used chip is a problem", used.problems.some((p) => p.includes("Bench Boost")));
const gone = previewApply({ ...base, moves: [{ outId: 18, inId: 16 }] }, myTeam, 99, players);
check("selling someone not owned is a problem", gone.problems.some((p) => p.includes("isn't in your FPL squad")));
const broke = previewApply(base, { ...myTeam, transfers: { ...myTeam.transfers, bank: 0 } }, 99, players);
check("overspending is a problem", broke.problems.some((p) => p.includes("Not enough money")));
const noTransfers = previewApply({ ...base, moves: [], starters: [1,3,4,5,6,8,9,10,11,13,14] }, myTeam, 99, players);
check("lineup only: no transfer request", noTransfers.transferPayload === null && noTransfers.problems.length === 0);
