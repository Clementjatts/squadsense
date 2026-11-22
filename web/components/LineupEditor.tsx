"use client";

// The Planner's lineup card: pick a player, then either tap another to swap
// them (starter for sub, or two subs' bench order) or give him the captain's
// or vice-captain's armband. On a Mac you pick players on the pitch in
// "Lineup" mode; on phones, which have no pitch, the card lists all 15.
// The rules themselves live in lib/planning.ts (swapInLineup, setArmband).

import type { WeekPlan } from "@/lib/planning";
import type { Player } from "@/lib/types";

const BENCH_LABELS = ["GK", "1st sub", "2nd sub", "3rd sub"];
const POSITION_ORDER = ["GK", "DEF", "MID", "FWD"];

// Starters in the order FPL lists them: keeper, defenders, midfielders, forwards.
function startersByPosition(starters: number[], players: Record<string, Player>): number[] {
  const rank = (id: number) => POSITION_ORDER.indexOf(players[String(id)]?.position ?? "FWD");
  return [...starters].sort((a, b) => rank(a) - rank(b));
}

interface LineupEditorProps {
  weekPlan: WeekPlan;
  players: Record<string, Player>;
  picked: number | null; // the player waiting for a swap or an armband
  message: string | null; // why the last swap or armband was refused
  showList: boolean; // false on a Mac in Lineup mode, where the pitch does the picking
  className?: string;
  onPick: (id: number) => void;
  onArmband: (role: "captain" | "vice") => void;
  onReset: () => void;
}

export function LineupEditor({ weekPlan, players, picked, message, showList, className, onPick, onArmband, onReset }: LineupEditorProps) {
  const name = (id: number) => players[String(id)]?.name ?? `#${id}`;
  const pickedStarts = picked !== null && weekPlan.starters.includes(picked);
  return (
    <section className={`card lineup-editor ${className ?? ""}`} aria-label={`GW${weekPlan.week} lineup`}>
      <div className="card-head">
        <h2>GW{weekPlan.week} lineup</h2>
        {weekPlan.lineupChosen ? (
          <button type="button" className="btn" onClick={onReset}>Back to best eleven</button>
        ) : (
          <span className="muted">Model&apos;s best eleven</span>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {picked === null
          ? "Pick a player to swap him with another, or to give him an armband."
          : `${name(picked)} picked. Pick another player to swap them${pickedStarts ? ", or give him an armband" : ""}.`}
      </p>
      {picked !== null && pickedStarts && (
        <div className="lineup-actions">
          <button type="button" className="btn primary" onClick={() => onArmband("captain")} disabled={picked === weekPlan.captain}>Make captain</button>
          <button type="button" className="btn" onClick={() => onArmband("vice")} disabled={picked === weekPlan.viceCaptain}>Make vice</button>
        </div>
      )}
      {message && <p className="bc-warn" role="alert" style={{ margin: 0 }}>{message}</p>}
      {showList && (
        <ul className="list lineup-list">
          {startersByPosition(weekPlan.starters, players).map((id) => (
            <LineupRow key={id} id={id} label={players[String(id)]?.position ?? ""} weekPlan={weekPlan} name={name(id)} picked={picked === id} onPick={onPick} />
          ))}
          {weekPlan.bench.map((id, index) => (
            <LineupRow key={id} id={id} label={BENCH_LABELS[index]} weekPlan={weekPlan} name={name(id)} picked={picked === id} onPick={onPick} bench />
          ))}
        </ul>
      )}
    </section>
  );
}

interface LineupRowProps {
  id: number;
  label: string; // position for a starter, bench slot for a sub
  name: string;
  weekPlan: WeekPlan;
  picked: boolean;
  bench?: boolean;
  onPick: (id: number) => void;
}

// One player in the list: his slot, name, armband and a button to pick him.
function LineupRow({ id, label, name, weekPlan, picked, bench = false, onPick }: LineupRowProps) {
  const armband = id === weekPlan.captain ? "C" : id === weekPlan.viceCaptain ? "VC" : null;
  return (
    <li className={bench ? "lineup-row lineup-bench" : "lineup-row"}>
      <span className="muted lineup-slot">{label}</span>
      <span className="grow">
        <strong>{name}</strong>
        {armband && <span className="bc-tag lineup-armband">{armband}</span>}
      </span>
      <button type="button" className="btn" aria-pressed={picked} onClick={() => onPick(id)} aria-label={`${picked ? "Unpick" : "Pick"} ${name}`}>
        {picked ? "Picked" : "Pick"}
      </button>
    </li>
  );
}
