"use client";

// The Fixture Ticker table with its toggles: attackers or defenders, how
// many gameweeks to rank by, and whether to highlight your clubs. All the
// numbers come from the snapshot; this only sorts and colors them.

import { useState } from "react";
import type { FixtureTicker, TickerMatch, TickerTeam } from "@/lib/types";

type Mode = "attack" | "defence";

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
        <div className="segmented" role="group" aria-label="Rank for">
          <button type="button" aria-pressed={mode === "attack"} onClick={() => setMode("attack")}>
            For attackers
          </button>
          <button type="button" aria-pressed={mode === "defence"} onClick={() => setMode("defence")}>
            For defenders
          </button>
        </div>
        <div className="ticker-toolbar-right">
          <span className="muted">Window</span>
          <div className="segmented" role="group" aria-label="Window">
            {ticker.windows.map((length) => (
              <button key={length} type="button" aria-pressed={windowLength === length} onClick={() => setWindowLength(length)}>
                {length} GWs
              </button>
            ))}
          </div>
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
              {rankedTeams.map((team) => (
                <tr key={team.id} className={myTeamIds.includes(team.id) ? "mine" : undefined}>
                  <th scope="row">{team.name}</th>
                  {shownWeeks.map((week) => (
                    <td key={week}>
                      <WeekCell matches={team.matches[String(week)] ?? []} mode={mode} />
                    </td>
                  ))}
                  <td className="right score">{score(team).toFixed(1)}</td>
                </tr>
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
