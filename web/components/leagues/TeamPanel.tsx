"use client";

// A rival's team, opened by clicking a team name in the league table. It
// slides in like the player panel, asks /api/teams/[entry] for the team's
// latest public lineup and draws it on the shared pitch: each player's tag
// shows the points he scored for that team, and players you own too glow
// lime. Clicking a player opens his own panel on top.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BroadcastPitch, type PlayerTag } from "../BroadcastPitch";
import { useOpenPlayer } from "../PlayerPanel";
import { formatPrice } from "@/lib/format";
import type { ChipCode, LeagueRow, PitchPlayer, Snapshot } from "@/lib/types";

const CHIP_NAMES: Record<string, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };
const CHIP_SHORT: Record<string, string> = { bboost: "BB", "3xc": "TC", freehit: "FH", wildcard: "WC" }; // FPL's own short names, so four fit in a tile

interface TeamView {
  teamName: string;
  manager: string;
  gameweek: number;
  chip: string | null;
  points: number;
  transferCost: number;
  value: number;
  bank: number;
  starters: number[];
  bench: number[];
  captain: number;
  viceCaptain: number;
  players: Record<string, PitchPlayer>;
  tags: Record<string, PlayerTag>;
  shared: number[];
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; team: TeamView };

// Fetches one team's lineup, reporting failures instead of hiding them.
function useTeam(entry: number): LoadState {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/teams/${entry}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
        if (!cancelled) setState({ kind: "ready", team: body as TeamView });
      })
      .catch((error: Error) => {
        console.error(`Couldn't load team ${entry}:`, error);
        if (!cancelled) setState({ kind: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);
  return state;
}

// The sliding panel: backdrop, header with the row's league numbers, then the team once it loads.
export function TeamPanel({ row, snapshot, onClose }: { row: LeagueRow; snapshot: Snapshot; onClose: () => void }) {
  const state = useTeam(row.entry);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => closeButton.current?.focus(), []);

  // Stop the page behind scrolling while the panel is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="panel-root">
      <motion.div className="panel-backdrop" aria-hidden="true" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      <motion.aside
        className="player-panel team-panel"
        role="dialog"
        aria-modal="true"
        aria-label={row.teamName}
        initial={{ x: "100%", opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
      >
        <div className="panel-head">
          <div className="grow">
            <h2>{row.teamName}</h2>
            <span className="muted">{row.manager} · {ordinal(row.rank)} in this league · {row.total.toLocaleString("en-GB")} points</span>
          </div>
          <button ref={closeButton} type="button" className="panel-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {state.kind === "loading" && <p className="muted">Loading their team...</p>}
        {state.kind === "error" && <p className="muted">Couldn&apos;t load this team: {state.message}</p>}
        {state.kind === "ready" && <TeamBody team={state.team} row={row} snapshot={snapshot} />}
      </motion.aside>
    </div>
  );
}

// The week's numbers in tiles, then the team on the pitch.
function TeamBody({ team, row, snapshot }: { team: TeamView; row: LeagueRow; snapshot: Snapshot }) {
  const openPlayer = useOpenPlayer();
  const earlier = team.gameweek < snapshot.weeks[0];
  return (
    <>
      <div className="team-tiles">
        <Tile label={`GW${team.gameweek} points`} value={String(team.points - team.transferCost)} note={team.transferCost ? `after a ${team.transferCost}-point hit` : undefined} />
        <Tile label="Team value" value={formatPrice(team.value)} note={`${formatPrice(team.bank)} in the bank`} />
        <Tile label="Chip played" value={team.chip ? CHIP_NAMES[team.chip] ?? team.chip : "None"} />
        <Tile label="Chips left" value={chipsLeft(row.chipsLeft, CHIP_SHORT)} title={chipsLeft(row.chipsLeft, CHIP_NAMES)} />
      </div>
      {earlier && (
        <p className="muted small" style={{ margin: 0 }}>
          Their GW{team.gameweek} team. FPL shows GW{snapshot.weeks[0]} picks once its deadline has passed.
        </p>
      )}
      <BroadcastPitch
        title={`THEIR TEAM IN GW${team.gameweek}`}
        hint={team.shared.length > 0 ? `Lime glow: you own him too (${team.shared.length})` : "No players in common with you"}
        starters={team.starters}
        bench={team.bench}
        captain={team.captain}
        viceCaptain={team.viceCaptain}
        players={team.players}
        week={team.gameweek}
        incomingIds={team.shared}
        tagFor={(id) => team.tags[String(id)] ?? { text: "0", label: "0 points", tone: "plain" }}
        benchNote="Bench points shown, though they didn't count"
        onPlayerClick={openPlayer}
      />
    </>
  );
}

// One number tile; `title` gives the full wording on hover where the value is shortened.
function Tile({ label, value, note, title }: { label: string; value: string; note?: string; title?: string }) {
  return (
    <div className="team-tile">
      <span className="muted small">{label}</span>
      <b title={title}>{value}</b>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

// "BB, WC" (or full names), "None" when all are used, or "-" when the league table doesn't know (big leagues).
function chipsLeft(chips: ChipCode[] | null, names: Record<string, string>): string {
  if (chips === null) return "-";
  return chips.length === 0 ? "None" : chips.map((chip) => names[chip] ?? chip).join(", ");
}

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][rank % 10] ?? "th";
  return `${rank.toLocaleString("en-GB")}${suffix}`;
}
