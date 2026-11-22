"use client";

// The Leagues page body: pick a league, then see its table and three
// short lists (threats, differentials, captains). Every row has a fixed
// height so switching league never shifts the layout.

import { useState } from "react";
import { PlayerLink } from "./PlayerPanel";
import { SegmentedControl } from "./SegmentedControl";
import { formatXp } from "@/lib/format";
import type { League, LeaguePlayerLine, Snapshot } from "@/lib/types";

const CHIP_NAMES: Record<string, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

export function LeaguesView({ snapshot }: { snapshot: Snapshot }) {
  const [leagueId, setLeagueId] = useState(snapshot.leagues[0].id);
  const league = snapshot.leagues.find((candidate) => candidate.id === leagueId) ?? snapshot.leagues[0];
  return (
    <>
      {snapshot.leagues.length > 1 && (
        <SegmentedControl
          label="League"
          layoutGroup="league-picker"
          options={snapshot.leagues.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          value={league.id}
          onChange={setLeagueId}
        />
      )}
      <div className="row">
        <div className="col-wide" style={{ flex: "1.4 1 640px" }}>
          <LeagueTable league={league} snapshot={snapshot} />
        </div>
        <div className="col-narrow" style={{ flex: "1 1 400px" }}>
          <PlayerShareCard
            title="Threats"
            note="Most rivals own him, you don't"
            lines={league.threats}
            snapshot={snapshot}
            empty="No player owned by most of this league is missing from your squad."
          />
          <PlayerShareCard
            title="Your differentials"
            note="Few rivals own him"
            lines={league.differentials}
            snapshot={snapshot}
            empty="Every one of your players is common in this league."
          />
          <PlayerShareCard title="Rivals' captains" note="Last gameweek" lines={league.topCaptains} snapshot={snapshot} useCaptainShare empty="No captains found." />
        </div>
      </div>
    </>
  );
}

// The standings, with your own row highlighted.
function LeagueTable({ league, snapshot }: { league: League; snapshot: Snapshot }) {
  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className="bc-table league-table">
          <colgroup>
            <col style={{ width: 76 }} />
            <col />
            <col style={{ width: 84 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">RANK</th>
              <th scope="col">TEAM</th>
              <th scope="col" className="right">GW</th>
              <th scope="col" className="right">TOTAL</th>
              <th scope="col">CAPTAIN</th>
              <th scope="col">CHIP</th>
            </tr>
          </thead>
          <tbody>
            {league.table.map((row) => {
              const isMine = row.entry === snapshot.team.id;
              const captain = row.captain ? snapshot.players[String(row.captain)] : undefined;
              return (
                <tr key={row.entry} className={isMine ? "bc-mine-row" : undefined}>
                  <td className="bc-cell-num">
                    {row.rank} <RankMove rank={row.rank} lastRank={row.lastRank} />
                  </td>
                  <td className="bc-cell-name">
                    {row.teamName} <span className="muted bc-manager">{row.manager}</span>
                  </td>
                  <td className="right bc-cell-num">{row.eventPoints}</td>
                  <td className="right bc-cell-num bc-cell-strong">{row.total}</td>
                  <td>{captain ? <PlayerLink id={captain.id} name={captain.name} /> : <span className="muted">-</span>}</td>
                  <td className={row.chip ? "bc-accent" : "muted"}>{row.chip ? CHIP_NAMES[row.chip] ?? row.chip : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// A small up or down arrow for rank movement since last week.
function RankMove({ rank, lastRank }: { rank: number; lastRank: number }) {
  if (!lastRank || rank === lastRank) return null;
  return rank < lastRank ? <span className="bc-accent">▲</span> : <span className="bc-warn">▼</span>;
}

interface PlayerShareCardProps {
  title: string;
  note: string;
  lines: LeaguePlayerLine[];
  snapshot: Snapshot;
  empty: string;
  useCaptainShare?: boolean;
}

// A short list of players with the share of rivals who own (or captain) them and next week's xP.
function PlayerShareCard({ title, note, lines, snapshot, empty, useCaptainShare = false }: PlayerShareCardProps) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="muted">{note}</span>
      </div>
      {lines.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <ul className="share-list">
          {lines.map((line) => {
            const player = snapshot.players[String(line.playerId)];
            const share = useCaptainShare ? line.captainShare : line.share;
            return (
              <li key={line.playerId} className="share-row">
                <span className="share-name">{player ? <PlayerLink id={player.id} name={player.name} /> : `#${line.playerId}`}</span>
                <span className="muted">{player?.team ?? ""}</span>
                <span className="share-track" aria-hidden="true"><span className="share-fill" style={{ width: `${Math.round(share * 100)}%` }} /></span>
                <b className="num">{Math.round(share * 100)}%</b>
                <span className="num muted">{formatXp(line.xp)} xP</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
