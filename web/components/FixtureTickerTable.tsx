"use client";

// The Fixture Ticker table with its toggles: attackers or defenders, how
// many gameweeks to rank by, and whether to highlight your clubs. All the
// numbers come from the snapshot; this only sorts and colors them.

import { motion } from "motion/react";
import { useState } from "react";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import type { FixtureTicker, TickerMatch, TickerTeam } from "@/lib/types";

type Mode = "attack" | "defence";

const MODE_OPTIONS: SegmentedOption<Mode>[] = [
  { value: "attack", label: "For attackers" },
  { value: "defence", label: "For defenders" },
];
const DIFFICULTY_LABELS = ["Easiest", "Easy", "Medium", "Hard", "Hardest"];

interface FixtureTickerTableProps {
  ticker: FixtureTicker;
  myTeamIds: number[];
}

export function FixtureTickerTable({ ticker, myTeamIds }: FixtureTickerTableProps) {
  const [mode, setMode] = useState<Mode>("attack");
  const [windowLength, setWindowLength] = useState(ticker.windows[ticker.windows.length - 1]);
  const [highlightMine, setHighlightMine] = useState(false);

  const score = (team: TickerTeam) => team.scores[mode][String(windowLength)];
  const rankedTeams = [...ticker.teams].sort((a, b) => score(b) - score(a));
  const shownWeeks = ticker.weeks.slice(0, windowLength);

  return (
    <>
      <div className="ticker-toolbar">
        <SegmentedControl label="Rank for" options={MODE_OPTIONS} value={mode} onChange={setMode} layoutGroup="ticker-mode" />
        <div className="ticker-toolbar-right">
          <span className="muted">Window</span>
          <SegmentedControl
            label="Window"
            options={ticker.windows.map((length) => ({ value: length, label: `${length} GWs` }))}
            value={windowLength}
            onChange={setWindowLength}
            layoutGroup="ticker-window"
          />
          <button type="button" className="btn" aria-pressed={highlightMine} onClick={() => setHighlightMine(!highlightMine)}>
            Highlight my teams
          </button>
        </div>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className={highlightMine ? "ticker highlighting" : "ticker"}>
            <thead>
              <tr>
                <th scope="col">Team</th>
                {shownWeeks.map((week) => (
                  <th scope="col" key={week} className="center">
                    GW{week}
                  </th>
                ))}
                <th scope="col" className="right">
                  {mode === "attack" ? "xG" : "Clean sheets"} ▾
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Rows glide to their new rank when the order changes. "position" moves
                  them up and down without stretching the table's columns. */}
              {rankedTeams.map((team) => (
                <motion.tr
                  key={team.id}
                  layout="position"
                  transition={{ type: "spring", stiffness: 360, damping: 34 }}
                  className={myTeamIds.includes(team.id) ? "mine" : undefined}
                >
                  <th scope="row">{team.name}</th>
                  {shownWeeks.map((week) => (
                    <td key={week}>
                      <WeekCell matches={team.matches[String(week)] ?? []} mode={mode} />
                    </td>
                  ))}
                  <td className="right score">{score(team).toFixed(1)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <TickerLegend mode={mode} />
      </section>
    </>
  );
}

// One gameweek for one club: a dashed "Blank", one block, or two stacked
// blocks for a double gameweek.
function WeekCell({ matches, mode }: { matches: TickerMatch[]; mode: Mode }) {
  if (matches.length === 0) {
    return <div className="fixture blank">Blank</div>;
  }
  return (
    <div className="fixture-stack">
      {matches.map((match, index) => {
        const level = mode === "attack" ? match.attackDifficulty : match.defenceDifficulty;
        return (
          <div
            key={index}
            className={`fixture level-${level}`}
            title={`${match.opponent} ${match.isHome ? "home" : "away"}: ${DIFFICULTY_LABELS[level - 1]}`}
          >
            {match.opponent} {match.isHome ? "H" : "A"}
          </div>
        );
      })}
    </div>
  );
}

// The color key and a plain explanation of what the score means.
function TickerLegend({ mode }: { mode: Mode }) {
  return (
    <div className="ticker-legend">
      <div className="ticker-key">
        {DIFFICULTY_LABELS.map((label, index) => (
          <span key={label}>
            <i className={`swatch level-${index + 1}`} aria-hidden="true" /> {label}
          </span>
        ))}
        <span className="muted">Two blocks = double gameweek</span>
      </div>
      <p className="muted">
        {mode === "attack"
          ? "Colors and score show how many goals each club is expected to score, from this season's xG for and against, adjusted for home and away."
          : "Colors and score show each club's chance of a clean sheet, from this season's xG for and against, adjusted for home and away."}{" "}
        The score adds up the window, with later weeks counting slightly less.
      </p>
    </div>
  );
}
