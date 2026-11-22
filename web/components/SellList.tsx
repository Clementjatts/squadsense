"use client";

// "Pick who to sell": the phone Planner's way of choosing a player to
// replace. On a Mac you tap a shirt on the pitch; phones hide the pitch to
// save space, so this card lists your squad by position instead. Choosing
// Sell starts exactly the same replacement search as a pitch click.

import { forwardRef, useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { formatPrice, formatXp } from "@/lib/format";
import type { Player, Position } from "@/lib/types";

const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

interface SellListProps {
  squad: number[]; // the selected week's 15, after that week's planned moves
  players: Record<string, Player>;
  captain: number;
  sellingIds: number[]; // players already sold this week
  selectedId: number | null; // the player whose replacement list is open
  onSell: (id: number) => void;
}

export const SellList = forwardRef<HTMLElement, SellListProps>(function SellList(
  { squad, players, captain, sellingIds, selectedId, onSell },
  ref,
) {
  const [position, setPosition] = useState<Position>("MID");
  // This position's players, best five-week xP first.
  const shown = squad
    .filter((id) => players[id].position === position)
    .sort((a, b) => players[b].windowXp - players[a].windowXp);

  return (
    <section className="card sell-list phone-only" ref={ref} id="pick-who-to-sell" aria-label="Pick who to sell">
      <div className="card-head">
        <h2>Pick who to sell</h2>
      </div>
      <SegmentedControl
        label="Position"
        layoutGroup="sell-list-position"
        options={POSITIONS.map((value) => ({ value, label: value }))}
        value={position}
        onChange={setPosition}
      />
      <ul className="list">
        {shown.map((id) => {
          const player = players[id];
          return (
            <li key={id}>
              <span className="grow">
                <strong>{player.name}</strong>
                {id === captain && <span className="bc-tag sell-list-tag">C</span>}
                <span className="muted sell-list-meta">
                  {player.team} · {formatPrice(player.price)} · {formatXp(player.windowXp)} xP
                </span>
              </span>
              {sellingIds.includes(id) ? (
                <span className="bc-tag bc-tag-warn">OUT</span>
              ) : (
                <button type="button" className="btn" aria-pressed={selectedId === id} onClick={() => onSell(id)} aria-label={`Sell ${player.name}`}>
                  Sell
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
});
