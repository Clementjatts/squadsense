"use client";

// Price Watch: summary cards, filters and the table of players closest to
// a price change. Every number is FPL's own predictor, copied into the
// snapshot by the sync job; this file only filters and draws it.

import { useState } from "react";
import { formatCount, formatPrice } from "@/lib/format";
import type { PriceWatch, PriceWatchRow } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { PlayerLink } from "./PlayerPanel";
import { SegmentedControl } from "./SegmentedControl";

type Filter = "all" | "rising" | "falling" | "mine" | "watchlist";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "rising", label: "Rising" },
  { key: "falling", label: "Falling" },
  { key: "mine", label: "My squad" },
  { key: "watchlist", label: "Watchlist" },
];
const ROWS_PER_PAGE = 25;
// Players this far (or further) towards a change glow, to catch the eye before 00:00.
const IMMINENT_PROGRESS = 95;

interface PriceWatchViewProps {
  watch: PriceWatch;
}

export function PriceWatchView({ watch }: PriceWatchViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0); // 0 is the first page
  const [watchlist, setWatchlist] = useWatchlist();

  const rowsById = new Map(watch.players.map((row) => [row.id, row]));
  const filtered = watch.players.filter((row) => matchesFilter(row, filter, watchlist));
  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

  // A new filter starts from the first page, since the old page may not exist any more.
  function chooseFilter(next: Filter) {
    setFilter(next);
    setPage(0);
  }

  function toggleWatch(id: number) {
    setWatchlist(watchlist.includes(id) ? watchlist.filter((watched) => watched !== id) : [...watchlist, id]);
  }

  return (
    <>
      <div className="summary-cards">
        <SquadCard title="Your players at risk" ids={watch.atRisk} rowsById={rowsById} direction="fall" />
        <SquadCard title="Your players rising" ids={watch.rising} rowsById={rowsById} direction="rise" />
      </div>

      {watch.calibrating && (
        <div className="info-banner">FPL is still calibrating its predictor, so these numbers may jump around.</div>
      )}

      <section className="card">
        <div className="card-head">
          <SegmentedControl
            label="Show"
            options={FILTERS.map(({ key, label }) => ({ value: key, label }))}
            value={filter}
            onChange={chooseFilter}
            layoutGroup="price-filter"
          />
          <span className="muted">Sorted by progress to a change</span>
        </div>
        <div className="table-wrap">
          <table className="prices">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Club</th>
                <th scope="col" className="right">Price</th>
                <th scope="col" className="right">Owned</th>
                <th scope="col" className="right">Net transfers (GW)</th>
                <th scope="col">Progress to change</th>
                <th scope="col">Prediction</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <PriceRow key={row.id} row={row} watched={watchlist.includes(row.id)} onToggleWatch={toggleWatch} />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="muted">{emptyMessage(filter)}</p>}
        {pageCount > 1 && (
          <Pager
            page={currentPage}
            pageCount={pageCount}
            first={currentPage * ROWS_PER_PAGE + 1}
            last={currentPage * ROWS_PER_PAGE + shown.length}
            total={filtered.length}
            onChange={setPage}
          />
        )}
        <p className="muted small">
          Progress over 100% means FPL expects the player to pass its threshold at the next change. These are FPL&apos;s
          own predictor figures. FPL refreshes them every 15 minutes and says they&apos;re a guide, not a guarantee.
        </p>
      </section>
    </>
  );
}

interface PagerProps {
  page: number;
  pageCount: number;
  first: number; // position of the first row shown, counting from 1
  last: number;
  total: number;
  onChange: (page: number) => void;
}

// Previous and Next buttons with "26-50 of 512", so a long list never needs a long scroll.
function Pager({ page, pageCount, first, last, total, onChange }: PagerProps) {
  return (
    <nav className="pager" aria-label="Table pages">
      <button type="button" className="btn" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="muted num">
        {first}-{last} of {total} · page {page + 1} of {pageCount}
      </span>
      <button type="button" className="btn" disabled={page === pageCount - 1} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </nav>
  );
}

// Which rows each filter keeps. Rising and falling go by FPL's projection
// for the next change, not just today's progress.
function matchesFilter(row: PriceWatchRow, filter: Filter, watchlist: number[]): boolean {
  switch (filter) {
    case "rising":
      return row.likelihood > 0;
    case "falling":
      return row.likelihood < 0;
    case "mine":
      return row.inSquad;
    case "watchlist":
      return watchlist.includes(row.id);
    default:
      return true;
  }
}

function emptyMessage(filter: Filter): string {
  if (filter === "watchlist") return "Your watchlist is empty. Click the star next to a player to add him.";
  return "No players to show here right now.";
}

// One table row: name with a watchlist star, club, numbers, progress bar.
function PriceRow({ row, watched, onToggleWatch }: { row: PriceWatchRow; watched: boolean; onToggleWatch: (id: number) => void }) {
  const rising = row.progress >= 0;
  return (
    <tr>
      <td>
        <span className="player-cell">
          <button
            type="button"
            className="star"
            aria-pressed={watched}
            aria-label={watched ? `Remove ${row.name} from watchlist` : `Add ${row.name} to watchlist`}
            onClick={() => onToggleWatch(row.id)}
          >
            {watched ? "★" : "☆"}
          </button>
          <PlayerLink id={row.id} name={row.name} />
          {row.inSquad && <span className="chip good">Yours</span>}
        </span>
      </td>
      <td className="muted">
        {row.team} · {row.position}
      </td>
      <td className="right">{formatPrice(row.price)}</td>
      <td className="right muted">{row.ownership.toFixed(1)}%</td>
      <td className="right num">{formatCount(row.netTransfers)}</td>
      <td className="progress-cell">
        <span className={`progress ${rising ? "rise" : "fall"}${Math.abs(row.progress) >= IMMINENT_PROGRESS ? " imminent" : ""}`}>
          <span aria-hidden="true">{rising ? "↑" : "↓"}</span>
          <span className="progress-track">
            <span className="progress-fill" style={{ width: `${Math.min(Math.abs(row.progress), 100)}%` }} />
          </span>
          <b>{Math.abs(row.progress).toFixed(0)}%</b>
        </span>
      </td>
      <td className="muted">
        {row.prediction}
        {row.projected !== null && !row.lockedUntil && (
          <span className="small"> · {Math.abs(row.projected).toFixed(0)}% by 00:00</span>
        )}
      </td>
    </tr>
  );
}

// "Your players at risk" and "Your players rising": a count and the most
// urgent name.
function SquadCard({ title, ids, rowsById, direction }: { title: string; ids: number[]; rowsById: Map<number, PriceWatchRow>; direction: "rise" | "fall" }) {
  const first = ids.length > 0 ? rowsById.get(ids[0]) : undefined;
  return (
    <section className="card summary-card">
      <span className="muted">{title}</span>
      <b className={`big ${ids.length > 0 && direction === "fall" ? "warn" : ""}`}>{ids.length}</b>
      <span className="muted">
        {first ? `${first.name}, ${Math.abs(first.progress).toFixed(0)}% to a ${direction}` : "None likely tonight"}
      </span>
    </section>
  );
}
