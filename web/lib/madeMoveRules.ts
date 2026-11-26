// Which transfers can be marked "Done on FPL". Any legal transfer for the
// coming week can be marked, not only the plan's suggestions. The check
// starts from the squad and bank the last sync saw, then applies any marks
// saved since that the snapshot doesn't include yet, so a second mark that
// needs the first one's money still fits. Used by /api/made-moves.

import { formatPrice } from "./format.ts";
import { MAX_PER_CLUB } from "./planning.ts";
import type { Position, Snapshot } from "./types.ts";

/** A mark from the made_moves table: who went out, who came in, and the price paid. */
export interface Mark {
  out: number;
  in: number;
  priceIn: number;
}

const POSITION_NAMES: Record<Position, string> = { GK: "goalkeeper", DEF: "defender", MID: "midfielder", FWD: "forward" };

/** Why `outId` → `inId` can't be marked, as a sentence for the page, or null when it's a legal transfer. */
export function madeMoveProblem(snapshot: Snapshot, savedMarks: Mark[], outId: number, inId: number): string | null {
  const { squad, bank, sellingPrices } = squadAfterNewMarks(snapshot, savedMarks);
  const out = snapshot.players[String(outId)];
  const into = snapshot.players[String(inId)];
  if (!out || !into) return "That player isn't in the latest data. Reload the page.";
  if (!squad.includes(outId)) return `${out.name} isn't in your squad.`;
  if (squad.includes(inId)) return `${into.name} is already in your squad.`;
  if (out.position !== into.position) return `${into.name} isn't a ${POSITION_NAMES[out.position]} like ${out.name}.`;
  const sameClub = squad.filter((id) => id !== outId && snapshot.players[String(id)]?.team === into.team).length + 1;
  if (sameClub > MAX_PER_CLUB) return `You'd have ${sameClub} ${into.team} players; FPL allows ${MAX_PER_CLUB}.`;
  const money = bank + (sellingPrices.get(outId) ?? out.price);
  if (into.price > money) return `${into.name} costs ${formatPrice(into.price)}, but selling ${out.name} leaves ${formatPrice(money)} to spend.`;
  return null;
}

// The squad, bank and selling prices once the marks saved since the last sync are made.
function squadAfterNewMarks(snapshot: Snapshot, savedMarks: Mark[]) {
  const synced = new Set((snapshot.madeMoves ?? []).map((mark) => `${mark.out}-${mark.in}`));
  let squad = [...snapshot.squad];
  let bank = snapshot.bank;
  const sellingPrices = new Map(squad.map((id) => [id, snapshot.players[String(id)]?.sellingPrice ?? snapshot.players[String(id)]?.price ?? 0]));
  for (const mark of savedMarks) {
    if (synced.has(`${mark.out}-${mark.in}`) || !squad.includes(mark.out) || squad.includes(mark.in)) continue;
    squad = squad.map((id) => (id === mark.out ? mark.in : id));
    bank += (sellingPrices.get(mark.out) ?? 0) - mark.priceIn;
    sellingPrices.delete(mark.out);
    sellingPrices.set(mark.in, mark.priceIn); // sells for what was paid until his price rises by £0.2m
  }
  return { squad, bank, sellingPrices };
}
