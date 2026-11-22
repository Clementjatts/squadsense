"use client";

// The Leagues page body: pick a league from the dropdown, then see its
// table and three short lists (threats, differentials, captains). Leagues
// over 100 teams show their table only (the top 50 and the 50 around you),
// since rivals' picks are only read for the smaller ones.

import { useState } from "react";
import { PlayerLink } from "./PlayerPanel";
import { formatXp } from "@/lib/format";
import type { League, LeaguePlayerLine, LeagueRow, Snapshot } from "@/lib/types";

// True when every rival's picks were read. Snapshots saved before big
// leagues were added have no `kind`, and every league in them was full.
function isFull(league: League): boolean {
  return league.kind !== "table";
}

const CHIP_NAMES: Record<string, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

export function LeaguesView({ snapshot }: { snapshot: Snapshot }) {
  const [leagueId, setLeagueId] = useState(snapshot.leagues[0].id);
  const league = snapshot.leagues.find((candidate) => candidate.id === leagueId) ?? snapshot.leagues[0];
  return (
    <>
      {snapshot.leagues.length > 1 && <LeaguePicker leagues={snapshot.leagues} value={league.id} onChange={setLeagueId} />}
      <div className="row">
        <div className="col-wide" style={{ flex: "1.4 1 640px" }}>
          <LeagueTable league={league} snapshot={snapshot} />
        </div>
        <div className="col-narrow" style={{ flex: "1 1 400px" }}>
          {isFull(league) ? <RivalCards league={league} snapshot={snapshot} /> : <TableOnlyNote league={league} />}
        </div>
      </div>
    </>
  );
}

// A dropdown of every league, smaller leagues (full analysis) listed first.
function LeaguePicker({ leagues, value, onChange }: { leagues: League[]; value: number; onChange: (id: number) => void }) {
  const groups: [string, League[]][] = [
    ["Rivals' picks read (up to 100 teams)", leagues.filter(isFull)],
    ["Table only (over 100 teams)", leagues.filter((league) => !isFull(league))],
  ];
  return (
    <label className="league-picker">
      <span className="muted">League</span>
      <select className="bc-select" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {groups
          .filter(([, group]) => group.length > 0)
          .map(([label, group]) => (
            <optgroup key={label} label={label}>
              {group.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name} · {league.size.toLocaleString("en-GB")} teams{league.myRank ? ` · you're ${league.myRank.toLocaleString("en-GB")}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </label>
  );
}

// For a big league: where you stand, and why the rival lists are missing.
function TableOnlyNote({ league }: { league: League }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Where you stand</h2>
      </div>
      {league.myRank !== null && (
        <p style={{ margin: 0 }}>
          <b className="num">{league.myRank.toLocaleString("en-GB")}</b> of {league.size.toLocaleString("en-GB")}
          {league.myLastRank ? <span className="muted"> · {league.myLastRank.toLocaleString("en-GB")} last week</span> : null}
        </p>
      )}
      <p className="muted" style={{ margin: 0 }}>
        This league has over 100 teams, so only its top 50 and the 50 around you are shown, refreshed once a day.
        Threats, differentials and captains need every rival&apos;s picks, which are only read for leagues of up to 100 teams.
      </p>
    </section>
  );
}

// Threats, differentials and captains for a league whose rivals' picks were read.
function RivalCards({ league, snapshot }: { league: League; snapshot: Snapshot }) {
  return (
    <>
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
    </>
  );
}

// The standings, with your own row highlighted. Big leagues have no
// captain or chip columns (their picks aren't read), and a "..." row marks
// the jump from the top 50 to the teams around you.
function LeagueTable({ league, snapshot }: { league: League; snapshot: Snapshot }) {
  const full = isFull(league);
  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className={full ? "bc-table league-table" : "bc-table league-table league-table-short"}>
          <colgroup>
            {/* Big leagues have five-figure ranks, so their rank column is wider. */}
            <col style={{ width: full ? 76 : 104 }} />
            <col />
            <col style={{ width: 84 }} />
            <col style={{ width: 90 }} />
            {full && <col style={{ width: 150 }} />}
            {full && <col style={{ width: 130 }} />}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">RANK</th>
              <th scope="col">TEAM</th>
              <th scope="col" className="right">GW</th>
              <th scope="col" className="right">TOTAL</th>
              {full && <th scope="col">CAPTAIN</th>}
              {full && <th scope="col">CHIP</th>}
            </tr>
          </thead>
          <tbody>
            {league.table.map((row, index) => (
              <TableRows key={row.entry} row={row} previous={league.table[index - 1]} full={full} snapshot={snapshot} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface TableRowsProps {
  row: LeagueRow;
  previous: LeagueRow | undefined;
  full: boolean;
  snapshot: Snapshot;
}

// One team's row, with a "..." row above it when ranks were skipped.
function TableRows({ row, previous, full, snapshot }: TableRowsProps) {
  const isMine = row.entry === snapshot.team.id;
  const captain = row.captain ? snapshot.players[String(row.captain)] : undefined;
  // Only big leagues leave rows out; ties alone (11, 11, 13) aren't a gap, so compare positions.
  const skipped = !full && previous !== undefined && (row.position ?? row.rank) > (previous.position ?? previous.rank) + 1;
  return (
    <>
      {skipped && (
        <tr className="league-gap" aria-hidden="true">
          <td colSpan={full ? 6 : 4} className="muted">...</td>
        </tr>
      )}
      <tr className={isMine ? "bc-mine-row" : undefined}>
        <td className="bc-cell-num">
          {row.rank.toLocaleString("en-GB")} <RankMove rank={row.rank} lastRank={row.lastRank} />
        </td>
        <td className="bc-cell-name">
          {row.teamName} <span className="muted bc-manager">{row.manager}</span>
        </td>
        <td className="right bc-cell-num">{row.eventPoints}</td>
        <td className="right bc-cell-num bc-cell-strong">{row.total.toLocaleString("en-GB")}</td>
        {full && <td>{captain ? <PlayerLink id={captain.id} name={captain.name} /> : <span className="muted">-</span>}</td>}
        {full && <td className={row.chip ? "bc-accent" : "muted"}>{row.chip ? CHIP_NAMES[row.chip] ?? row.chip : "-"}</td>}
      </tr>
    </>
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
