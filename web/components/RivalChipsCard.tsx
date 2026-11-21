"use client";

// Which chips your mini-league rivals still have this half. A rival
// holding Triple Captain can jump you in one week, so it's worth knowing
// before you decide when to play yours.

import { useState } from "react";
import type { ChipCode, RivalChips } from "@/lib/types";

const CHIP_SHORT: Record<ChipCode, string> = { bboost: "BB", "3xc": "TC", freehit: "FH", wildcard: "WC" };
const CHIP_ORDER: ChipCode[] = ["bboost", "3xc", "freehit", "wildcard"];

export function RivalChipsCard({ rivals }: { rivals: RivalChips[] }) {
  const [leagueId, setLeagueId] = useState(rivals[0].id);
  const league = rivals.find((item) => item.id === leagueId) ?? rivals[0];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Rivals&apos; chips</h2>
        {rivals.length > 1 ? (
          <select className="bc-select" aria-label="League" value={league.id} onChange={(event) => setLeagueId(Number(event.target.value))}>
            {rivals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : (
          <span className="muted">{league.name}</span>
        )}
      </div>
      <div className="summary-grid rival-holding">
        {CHIP_ORDER.map((chip) => (
          <div key={chip}>
            <span className="muted">{CHIP_SHORT[chip]} still held</span>
            <b className="num">{league.holding[chip]} / {league.rivals}</b>
          </div>
        ))}
      </div>
      <ol className="share-list">
        {league.rows.map((row) => (
          <li key={row.entry} className="rival-chip-row">
            <span className="muted num">{row.rank}</span>
            <span className="share-name">{row.teamName}</span>
            <span className="rival-chip-tags">
              {CHIP_ORDER.map((chip) => (
                <span key={chip} className={row.chipsLeft.includes(chip) ? "bc-set-tag rival-chip-on" : "bc-set-tag rival-chip-off"}>
                  {CHIP_SHORT[chip]}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
