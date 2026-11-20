"use client";

// The player detail panel that slides in from the right. Any page can open
// it with <PlayerLink>. The panel loads one player's details from
// /api/players/[id] when it opens, so pages don't carry every player's
// history around.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { formatPrice, formatXp } from "@/lib/format";
import type { PlayerDetail } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";

const PanelContext = createContext<((playerId: number) => void) | null>(null);

// Wrap the app in this once (in the layout) so any PlayerLink can open the panel.
export function PlayerPanelProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <PanelContext.Provider value={setOpenId}>
      {children}
      {openId !== null && <PlayerPanel key={openId} playerId={openId} onClose={() => setOpenId(null)} />}
    </PanelContext.Provider>
  );
}

// Returns the function that opens the panel for a player.
export function useOpenPlayer(): (playerId: number) => void {
  const open = useContext(PanelContext);
  if (!open) throw new Error("useOpenPlayer must be used inside PlayerPanelProvider");
  return open;
}

// A player's name that opens his panel when clicked.
export function PlayerLink({ id, name }: { id: number; name: string }) {
  const openPlayer = useOpenPlayer();
  return (
    <button type="button" className="player-link" onClick={() => openPlayer(id)}>
      {name}
    </button>
  );
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: PlayerDetail };

// Fetches one player's details, reporting failures instead of hiding them.
function usePlayerDetail(playerId: number): LoadState {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/players/${playerId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
        if (!cancelled) setState({ kind: "ready", detail: body as PlayerDetail });
      })
      .catch((error: Error) => {
        console.error(`Couldn't load player ${playerId}:`, error);
        if (!cancelled) setState({ kind: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);
  return state;
}

// The panel itself: a dimmed backdrop and the sliding sheet. Escape, the
// close button or a click on the backdrop closes it.
function PlayerPanel({ playerId, onClose }: { playerId: number; onClose: () => void }) {
  const state = usePlayerDetail(playerId);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Move keyboard focus into the panel once, when it opens.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = state.kind === "ready" ? state.detail.fullName : "Player details";
  return (
    <>
      <div className="panel-backdrop" aria-hidden="true" onClick={onClose} />
      <aside className="player-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head">
          <div className="grow">
            <h2>{title}</h2>
            {state.kind === "ready" && <span className="muted">{headerLine(state.detail)}</span>}
          </div>
          <button ref={closeButton} type="button" className="panel-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {state.kind === "loading" && <p className="muted">Loading…</p>}
        {state.kind === "error" && <p className="muted">Couldn&apos;t load this player: {state.message}</p>}
        {state.kind === "ready" && <PanelBody detail={state.detail} />}
      </aside>
    </>
  );
}

// "Man City · Forward · £14.6m · penalty taker 1st"
function headerLine(detail: PlayerDetail): string {
  const parts = [detail.teamName, detail.positionName, formatPrice(detail.price)];
  if (detail.penaltyOrder) parts.push(`penalty taker ${ordinal(detail.penaltyOrder)}`);
  return parts.join(" · ");
}

function ordinal(position: number): string {
  return `${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"}`;
}

function PanelBody({ detail }: { detail: PlayerDetail }) {
  const [watchlist, setWatchlist] = useWatchlist();
  const watched = watchlist.includes(detail.id);
  return (
    <>
      <div className="panel-tiles">
        <Tile label={`xP GW${detail.nextGameweek}`} value={formatXp(detail.xpNext)} />
        <Tile label="Owned" value={`${detail.ownership.toFixed(1)}%`} />
        <Tile label="Mins/match" value={String(detail.minutesPerMatch)} />
        <Tile label={detail.sellingPrice === null ? "Price" : "Sells for"} value={formatPrice(detail.sellingPrice ?? detail.price)} />
      </div>
      <RecentChart detail={detail} />
      <section className="panel-section">
        <h3>Next fixtures</h3>
        <div className="panel-fixtures">
          {detail.fixtures.map((fixture, index) => (
            <div key={index} className="panel-fixture">
              <span className="muted">GW{fixture.gameweek}</span>
              <span className={`fixture level-${fixture.difficulty}`}>
                {fixture.opponent} {fixture.isHome ? "H" : "A"}
              </span>
            </div>
          ))}
          {detail.fixtures.length === 0 && <span className="muted">No fixtures scheduled.</span>}
        </div>
      </section>
      <section className="panel-section">
        <h3>News and price</h3>
        <p className="muted">{newsAndPrice(detail)}</p>
      </section>
      <div>
        <button
          type="button"
          className={watched ? "btn" : "btn primary"}
          onClick={() => setWatchlist(watched ? watchlist.filter((id) => id !== detail.id) : [...watchlist, detail.id])}
        >
          {watched ? "Remove from watchlist" : "Add to watchlist"}
        </button>
      </div>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-tile">
      <span className="muted">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}

// Bars for the last few gameweeks: xG (lime) stacked under xA (blue), with
// points on top. Bars share one scale so weeks can be compared; the scale
// never drops below 1.0 so a quiet run doesn't look dramatic.
function RecentChart({ detail }: { detail: PlayerDetail }) {
  const BAR_HEIGHT = 120;
  const scale = Math.max(1, ...detail.recent.map((week) => week.xg + week.xa));
  return (
    <section className="panel-section">
      <div className="card-head">
        <h3>Last {detail.recent.length} gameweeks</h3>
        <span className="chart-key muted">
          <i className="swatch xg" aria-hidden="true" /> xG <i className="swatch xa" aria-hidden="true" /> xA
        </span>
      </div>
      <div className="recent-chart">
        {detail.recent.map((week) => (
          <div key={week.gameweek} className="recent-week" title={`${week.minutes} minutes, ${week.xg} xG, ${week.xa} xA`}>
            <span className="recent-points">{week.points} pts</span>
            <div className="recent-bar" style={{ height: BAR_HEIGHT }}>
              <div className="bar xa" style={{ height: (week.xa / scale) * BAR_HEIGHT }} />
              <div className="bar xg" style={{ height: (week.xg / scale) * BAR_HEIGHT }} />
            </div>
            <span className="muted small">GW{week.gameweek}</span>
          </div>
        ))}
      </div>
      <p className="muted small">
        {detail.xgPer90} xG and {detail.xaPer90} xA per 90 minutes, weighted to recent matches.
      </p>
    </section>
  );
}

// One plain sentence each for fitness, bookings and price.
function newsAndPrice(detail: PlayerDetail): string {
  const fitness =
    detail.chance !== null && detail.chance < 100
      ? `${detail.chance}% chance of playing. ${detail.news || "No details yet."}`
      : detail.news || "No injury news.";
  const bookings = `${detail.yellowCards} yellow card${detail.yellowCards === 1 ? "" : "s"}.`;
  const direction = detail.priceProgress >= 0 ? "rise" : "fall";
  const price =
    detail.pricePrediction === "No change"
      ? "Price steady."
      : `Price: ${detail.pricePrediction.toLowerCase()}, ${Math.abs(detail.priceProgress).toFixed(0)}% of the way to a ${direction}.`;
  return `${fitness} ${bookings} ${price}`;
}
