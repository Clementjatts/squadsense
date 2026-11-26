"use client";

// The Leagues page body: pick a league from the dropdown, then see its
// table 20 teams a page at full width, then where you stand beside rivals'
// captains, then this week's exposure at full width (ExposureCard.tsx).
// Leagues over 100 teams show their top 50 and the 50 around you, and their
// lists come from a sample of rivals: the top 10 and the 10 either side of you.

import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PlayerLink } from "./PlayerPanel";
import { ExposureCard } from "./leagues/ExposureCard";
import { TeamPanel } from "./leagues/TeamPanel";
import { formatXp } from "@/lib/format";
import { pageCount, pageRows, pageWithEntry } from "@/lib/leagueTable";
import type { League, LeaguePlayerLine, LeagueRow, Snapshot } from "@/lib/types";

// True when every rival's picks were read. Snapshots saved before big
// leagues were added have no `kind`, and every league in them was full.
function isFull(league: League): boolean {
  return league.kind !== "table";
}

const CHIP_NAMES: Record<string, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

// `chosenId` is the league sent in full; the others have only their name
// and size, so picking one loads its page (?league=id) from the server.
export function LeaguesView({ snapshot, chosenId }: { snapshot: Snapshot; chosenId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const league = snapshot.leagues.find((candidate) => candidate.id === chosenId) ?? snapshot.leagues[0];
  const choose = (id: number) => startTransition(() => router.replace(`/leagues?league=${id}`, { scroll: false }));
  return (
    <>
      {snapshot.leagues.length > 1 && <LeaguePicker leagues={snapshot.leagues} value={league.id} onChange={choose} />}
      {pending && <span className="muted">Loading the league...</span>}
      <LeagueTable key={league.id} league={league} snapshot={snapshot} />
      <RivalCards league={league} snapshot={snapshot} />
    </>
  );
}

// A dropdown of every league, smaller leagues (full analysis) listed first.
function LeaguePicker({ leagues, value, onChange }: { leagues: League[]; value: number; onChange: (id: number) => void }) {
  const groups: [string, League[]][] = [
    ["Every rival read (up to 100 teams)", leagues.filter(isFull)],
    ["A sample of rivals read (over 100 teams)", leagues.filter((league) => !isFull(league))],
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

// Your rank, and how far you are from the leader and the teams either side of you.
function WhereYouStand({ league }: { league: League }) {
  const standing = league.standing;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Where you stand</h2>
        {league.myRank !== null && (
          <span className="muted">
            <b className="num">{league.myRank.toLocaleString("en-GB")}</b> of {league.size.toLocaleString("en-GB")}
            {league.myLastRank ? ` · ${league.myLastRank.toLocaleString("en-GB")} last week` : ""}
          </span>
        )}
      </div>
      {standing ? (
        <ul className="stand-list">
          <li><span className="muted">Behind the leader</span><b className="num">{standing.leaderGap === 0 ? "You lead" : `${standing.leaderGap} pts`}</b></li>
          <li><span className="muted">To catch {standing.above?.teamName ?? "the team above"}</span><b className="num">{standing.above ? `${standing.above.gap} pts` : "-"}</b></li>
          <li><span className="muted">Ahead of {standing.below?.teamName ?? "the team below"}</span><b className="num">{standing.below ? `${standing.below.gap} pts` : "-"}</b></li>
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Your row isn&apos;t in this table yet. It shows after the next sync.</p>
      )}
    </section>
  );
}

// Whose picks the lists come from, for the cards' notes.
function picksSource(league: League): string {
  return league.picksFrom === "sample"
    ? `Among the top 10 and the ${league.rivalsWithPicks - Math.min(10, league.rivalsWithPicks)} teams around you`
    : `Among all ${league.rivalsWithPicks} rivals`;
}

// Where you stand beside rivals' captains (two cards that share a height),
// then this week's exposure across the full width.
function RivalCards({ league, snapshot }: { league: League; snapshot: Snapshot }) {
  return (
    <>
      <p className="muted league-source">Lists below: {picksSource(league).toLowerCase()}, last gameweek.</p>
      <div className="bc-row bc-row-2">
        <WhereYouStand league={league} />
        <PlayerShareCard title="Rivals' captains" note="Last gameweek" lines={league.topCaptains} snapshot={snapshot} useCaptainShare empty="No captains found." />
      </div>
      <ExposureCard exposure={league.exposure} snapshot={snapshot} />
    </>
  );
}

// The standings, 20 teams a page, opening on the page with your row. A
// team's name opens its whole team (TeamPanel.tsx). In a
// big league a "..." row marks the jump from the top 50 to the teams around
// you, and only the sampled rivals have a captain and chip.
function LeagueTable({ league, snapshot }: { league: League; snapshot: Snapshot }) {
  const full = isFull(league);
  const myPage = pageWithEntry(league.table, snapshot.team.id);
  const [page, setPage] = useState(myPage);
  const [openTeam, setOpenTeam] = useState<LeagueRow | null>(null); // the team whose panel is open
  const pages = pageCount(league.table.length);
  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className={full ? "bc-table league-table" : "bc-table league-table league-table-wide-rank"}>
          <colgroup>
            {/* Big leagues have five-figure ranks, so their rank column is wider. */}
            <col style={{ width: full ? 76 : 104 }} />
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
            {pageRows(league.table, page).map(({ row, index }) => (
              <TableRows key={row.entry} row={row} previous={league.table[index - 1]} full={full} snapshot={snapshot} onOpen={setOpenTeam} />
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && <Pager page={page} pages={pages} myPage={myPage} onChange={setPage} />}
      <AnimatePresence>
        {openTeam && <TeamPanel key={openTeam.entry} row={openTeam} snapshot={snapshot} onClose={() => setOpenTeam(null)} />}
      </AnimatePresence>
    </section>
  );
}

interface TableRowsProps {
  row: LeagueRow;
  previous: LeagueRow | undefined;
  full: boolean;
  snapshot: Snapshot;
  onOpen: (row: LeagueRow) => void; // opens the team's panel
}

// One team's row, with a "..." row above it when ranks were skipped.
function TableRows({ row, previous, full, snapshot, onOpen }: TableRowsProps) {
  const isMine = row.entry === snapshot.team.id;
  const captain = row.captain ? snapshot.players[String(row.captain)] : undefined;
  // Only big leagues leave rows out; ties alone (11, 11, 13) aren't a gap, so compare positions.
  const skipped = !full && previous !== undefined && (row.position ?? row.rank) > (previous.position ?? previous.rank) + 1;
  return (
    <>
      {skipped && (
        <tr className="league-gap" aria-hidden="true">
          <td colSpan={6} className="muted">...</td>
        </tr>
      )}
      <tr className={isMine ? "bc-mine-row" : undefined}>
        <td className="bc-cell-num">
          {row.rank.toLocaleString("en-GB")} <RankMove rank={row.rank} lastRank={row.lastRank} />
        </td>
        <td className="bc-cell-name">
          {/* The team name opens its whole team in a panel. */}
          <button type="button" className="team-link" onClick={() => onOpen(row)}>{row.teamName}</button>{" "}
          <span className="muted bc-manager">{row.manager}</span>
        </td>
        <td className="right bc-cell-num">{row.eventPoints}</td>
        <td className="right bc-cell-num bc-cell-strong">{row.total.toLocaleString("en-GB")}</td>
        <td>{captain ? <PlayerLink id={captain.id} name={captain.name} /> : <span className="muted">-</span>}</td>
        <td className={row.chip ? "bc-accent" : "muted"}>{row.chip ? CHIP_NAMES[row.chip] ?? row.chip : "-"}</td>
      </tr>
    </>
  );
}

// Previous and Next under the table, the page number, and a way back to your own row.
function Pager({ page, pages, myPage, onChange }: { page: number; pages: number; myPage: number; onChange: (page: number) => void }) {
  return (
    <nav className="league-pager" aria-label="League table pages">
      <button type="button" className="btn" onClick={() => onChange(page - 1)} disabled={page === 0}>Previous</button>
      <span className="muted num">Page {page + 1} of {pages}</span>
      <button type="button" className="btn" onClick={() => onChange(page + 1)} disabled={page === pages - 1}>Next</button>
      <button type="button" className="btn league-pager-me" onClick={() => onChange(myPage)} disabled={page === myPage}>Jump to me</button>
    </nav>
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
