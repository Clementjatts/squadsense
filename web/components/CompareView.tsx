"use client";

// The comparison table. Each column is one player, loaded from
// /api/players/[id]; each row is one stat, with the best value in lime.
// Adding or removing a player updates the address so it can be shared.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice, formatXp } from "@/lib/format";
import { searchPlayers, usePlayerIndex } from "@/lib/playerIndex";
import type { PlayerDetail } from "@/lib/types";

const MAX_PLAYERS = 3;

interface StatRow {
  label: string;
  value: (detail: PlayerDetail) => number | null;
  format: (value: number) => string;
  higherIsBetter: boolean;
}

const per90 = (total: number, minutes: number) => (minutes > 0 ? (total * 90) / minutes : 0);
const fixed = (digits: number) => (value: number) => value.toFixed(digits);
const whole = (value: number) => String(Math.round(value));

const STAT_ROWS: StatRow[] = [
  { label: "Price", value: (d) => d.price, format: formatPrice, higherIsBetter: false },
  { label: "Owned by", value: (d) => d.ownership, format: (v) => `${v.toFixed(1)}%`, higherIsBetter: false },
  { label: "xP next gameweek", value: (d) => d.xpNext, format: formatXp, higherIsBetter: true },
  { label: "FPL's xP next gameweek", value: (d) => d.fplXp, format: formatXp, higherIsBetter: true },
  { label: "Points this season", value: (d) => d.season.points, format: whole, higherIsBetter: true },
  { label: "Points per £m", value: (d) => d.season.points / (d.price / 10), format: fixed(1), higherIsBetter: true },
  { label: "Minutes per match", value: (d) => d.minutesPerMatch, format: whole, higherIsBetter: true },
  { label: "Goals", value: (d) => d.season.goals, format: whole, higherIsBetter: true },
  { label: "Assists", value: (d) => d.season.assists, format: whole, higherIsBetter: true },
  { label: "xG per 90 (model)", value: (d) => d.xgPer90, format: fixed(2), higherIsBetter: true },
  { label: "xA per 90 (model)", value: (d) => d.xaPer90, format: fixed(2), higherIsBetter: true },
  { label: "xG this season", value: (d) => d.season.xg, format: fixed(2), higherIsBetter: true },
  { label: "xA this season", value: (d) => d.season.xa, format: fixed(2), higherIsBetter: true },
  { label: "Clean sheets", value: (d) => d.season.cleanSheets, format: whole, higherIsBetter: true },
  { label: "Bonus", value: (d) => d.season.bonus, format: whole, higherIsBetter: true },
  { label: "Defensive contributions per 90", value: (d) => per90(d.season.defensiveContribution, d.season.minutes), format: fixed(1), higherIsBetter: true },
  { label: "Points last season", value: (d) => d.pastSeasons[0]?.points ?? null, format: whole, higherIsBetter: true },
  { label: "Average fixture difficulty, next 6", value: (d) => averageDifficulty(d), format: fixed(1), higherIsBetter: false },
];

// Mean difficulty (1 easiest, 5 hardest) of his next fixtures, or null if he has none.
function averageDifficulty(detail: PlayerDetail): number | null {
  if (detail.fixtures.length === 0) return null;
  return detail.fixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / detail.fixtures.length;
}

// Loads detail entries for the chosen ids, keeping ones already loaded.
function useDetails(ids: number[]): { details: Record<number, PlayerDetail>; error: string | null } {
  const [details, setDetails] = useState<Record<number, PlayerDetail>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const missing = ids.filter((id) => !details[id]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (id) => {
        const response = await fetch(`/api/players/${id}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Player ${id} failed with status ${response.status}`);
        return body as PlayerDetail;
      }),
    )
      .then((loaded) => setDetails((previous) => ({ ...previous, ...Object.fromEntries(loaded.map((detail) => [detail.id, detail])) })))
      .catch((loadError: Error) => setError(loadError.message));
  }, [ids, details]);
  return { details, error };
}

export function CompareView({ initialIds }: { initialIds: number[] }) {
  const router = useRouter();
  const [ids, setIds] = useState(initialIds);
  const { details, error } = useDetails(ids);

  function updateIds(next: number[]) {
    setIds(next);
    router.replace(next.length > 0 ? `/compare?ids=${next.join(",")}` : "/compare", { scroll: false });
  }

  const loaded = ids.map((id) => details[id]).filter((detail): detail is PlayerDetail => Boolean(detail));
  return (
    <section className="bc-card bc-table-card">
      {error && <p className="bc-warn" style={{ padding: "12px 16px", margin: 0 }}>{error}</p>}
      <div className="table-wrap">
        <table className="bc-table compare-table">
          <colgroup>
            {/* Width set in CSS: 280px on a Mac, narrower on phones. */}
            <col className="compare-stat-col" />
            {Array.from({ length: MAX_PLAYERS }, (_, index) => <col key={index} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">STAT</th>
              {Array.from({ length: MAX_PLAYERS }, (_, index) => {
                const detail = details[ids[index]];
                return (
                  <th key={index} scope="col" className="right">
                    {ids[index] === undefined ? (
                      <AddPlayer exclude={ids} onAdd={(id) => updateIds([...ids, id])} />
                    ) : (
                      <span className="compare-head">
                        <span className="compare-name">{detail ? `${detail.name} · ${detail.team}` : "Loading..."}</span>
                        <button type="button" className="compare-remove" aria-label="Remove player" onClick={() => updateIds(ids.filter((id) => id !== ids[index]))}>×</button>
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((row) => <CompareRow key={row.label} row={row} columns={ids.map((id) => details[id])} enoughToCompare={loaded.length > 1} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// One stat across the chosen players, with the best value lit up.
function CompareRow({ row, columns, enoughToCompare }: { row: StatRow; columns: (PlayerDetail | undefined)[]; enoughToCompare: boolean }) {
  const values = columns.map((detail) => (detail ? row.value(detail) : null));
  const known = values.filter((value): value is number => value !== null);
  const best = known.length > 0 ? (row.higherIsBetter ? Math.max(...known) : Math.min(...known)) : null;
  return (
    <tr>
      <td className="muted">{row.label}</td>
      {Array.from({ length: MAX_PLAYERS }, (_, index) => {
        const value = values[index];
        const isBest = enoughToCompare && value !== null && value === best;
        return (
          <td key={index} className={`right bc-cell-num ${isBest ? "bc-accent bc-cell-strong" : ""}`}>
            {value === null || value === undefined ? "-" : row.format(value)}
          </td>
        );
      })}
    </tr>
  );
}

// A search box in an empty column; picking a result adds that player.
function AddPlayer({ exclude, onAdd }: { exclude: number[]; onAdd: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const { players } = usePlayerIndex(isFocused || query.length > 0);
  const results = searchPlayers(players, query, 6).filter((player) => !exclude.includes(player.id));
  return (
    <span className="compare-add">
      <input
        className="compare-input"
        placeholder="Add a player"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        aria-label="Add a player to compare"
      />
      {isFocused && results.length > 0 && (
        <ul className="compare-results">
          {results.map((player) => (
            <li key={player.id}>
              <button type="button" onMouseDown={() => { onAdd(player.id); setQuery(""); }}>
                {player.name} <span className="muted">{player.team} · {formatPrice(player.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
