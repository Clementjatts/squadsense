"use client";

// "This week's exposure" on the Leagues page: rivals' last lineups against
// your planned team for the coming week. Effective ownership counts a
// captain twice and the bench not at all, so it shows who really decides
// points between you and the league. A headline gives the expected swing
// against the average rival; "Costing you" lists players rivals own more
// than you, "Gaining you" your players they own less. Each player keeps the
// plain numbers too: how many rivals own him and how many captain him.
// A big league switches between its Top 10 and the teams around you.

import { useState } from "react";
import { PlayerLink } from "../PlayerPanel";
import { SegmentedControl } from "../SegmentedControl";
import { formatXp } from "@/lib/format";
import type { ExposureGroup, ExposureLine, LeagueExposure, Snapshot } from "@/lib/types";

const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (points: number) => `${points > 0 ? "+" : points < 0 ? "−" : ""}${Math.abs(points).toFixed(1)}`;

export function ExposureCard({ exposure, snapshot }: { exposure: LeagueExposure | undefined; snapshot: Snapshot }) {
  const [groupKey, setGroupKey] = useState<ExposureGroup["key"]>("top");
  if (!exposure || exposure.groups.length === 0) {
    return (
      <section className="card">
        <div className="card-head"><h2>This week&apos;s exposure</h2></div>
        <p className="muted" style={{ margin: 0 }}>Appears after the next sync, once rivals&apos; lineups have been read.</p>
      </section>
    );
  }
  const group = exposure.groups.find((candidate) => candidate.key === groupKey) ?? exposure.groups[0];
  return (
    <section className="card exposure">
      <div className="card-head">
        <h2>This week&apos;s exposure</h2>
        <span className="muted">Your plan for GW{snapshot.weeks[0]} against rivals&apos; GW{exposure.picksWeek} lineups</span>
      </div>
      <div className="exposure-top">
        <div className="exposure-swing">
          <b className={`num ${group.swing > 0 ? "bc-accent" : group.swing < 0 ? "bc-warn" : ""}`}>{signed(group.swing)}</b>
          <span className="muted">
            expected points against the average of {group.rivals} {group.rivals === 1 ? "rival" : "rivals"}
            {group.key === "top" ? " in the top 10" : group.key === "around" ? " around you" : ""}
          </span>
        </div>
        {exposure.groups.length > 1 && (
          <SegmentedControl
            label="Compare with"
            options={exposure.groups.map((item) => ({ value: item.key, label: item.label }))}
            value={group.key}
            onChange={setGroupKey}
            layoutGroup="exposure-group"
          />
        )}
      </div>
      <p className="muted small exposure-key">
        Captains count twice, benches not at all. The swing is your share minus theirs, times his xP for GW{snapshot.weeks[0]}.
      </p>
      <div className="exposure-lists">
        <ExposureList title="Costing you" note="Rivals own him more than you" lines={group.costing} snapshot={snapshot}
          empty="No player gives the league an edge over your plan." />
        <ExposureList title="Gaining you" note="You own him more than rivals" lines={group.gaining} snapshot={snapshot}
          empty="None of your planned players is rarer in this league than in your team." />
      </div>
    </section>
  );
}

interface ExposureListProps {
  title: string;
  note: string;
  lines: ExposureLine[];
  snapshot: Snapshot;
  empty: string;
}

// One side of the card: each player with rivals' effective ownership against yours and the expected swing,
// and underneath, how many rivals own and captain him and his xP.
function ExposureList({ title, note, lines, snapshot, empty }: ExposureListProps) {
  return (
    <div className="exposure-list">
      <div className="exposure-list-head">
        <h3>{title}</h3>
        <span className="muted small">{note}</span>
      </div>
      {lines.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <ul className="share-list">
          <li className="exposure-row exposure-row-head muted" aria-hidden="true">
            <span>Player</span>
            <span>Rivals</span>
            <span>You</span>
            <span>Swing</span>
          </li>
          {lines.map((line) => {
            const player = snapshot.players[String(line.playerId)];
            return (
              <li key={line.playerId} className="exposure-row">
                <span className="exposure-player">
                  <span className="share-name">{player ? <PlayerLink id={player.id} name={player.name} /> : `#${line.playerId}`}</span>
                  <span className="muted small">
                    {player?.team ? `${player.team} · ` : ""}owned {percent(line.owned)} · captained {percent(line.captained)} · {formatXp(line.xp)} xP
                  </span>
                </span>
                <span className="num muted">{percent(line.eo)}</span>
                <span className="num">{percent(line.mine)}</span>
                <b className={`num ${line.swing > 0 ? "bc-accent" : "bc-warn"}`}>{signed(line.swing)}</b>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
