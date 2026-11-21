// Squad analysis table: the detail behind the pitch. Value, five-week xP,
// form, next three fixtures and price movement, one fixed-height row per
// player, starters first and then the bench.

import { formatPrice, formatXp } from "@/lib/format";
import { nextFixtures, priceRow, tableOrder } from "@/lib/dashboard";
import type { Snapshot } from "@/lib/types";
import { PlayerLink } from "../PlayerPanel";
import { Sparkline } from "./Sparkline";

export function SquadTable({ snapshot }: { snapshot: Snapshot }) {
  const lineup = snapshot.lineups[String(snapshot.gameweek)];
  const ids = tableOrder(lineup.starters, lineup.bench, snapshot.players);
  const bestWindowXp = Math.max(...ids.map((id) => snapshot.players[String(id)].windowXp));

  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className="bc-table">
          <colgroup>
            <col style={{ width: 64 }} />
            <col />
            <col style={{ width: 68 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">POS</th>
              <th scope="col">PLAYER</th>
              <th scope="col">CLUB</th>
              <th scope="col" className="right">PRICE</th>
              <th scope="col" className="right">xP {snapshot.weeks.length} GW</th>
              <th scope="col">FORM</th>
              <th scope="col">NEXT 3</th>
              <th scope="col" className="right">PRICE CHANGE</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id, index) => {
              const player = snapshot.players[String(id)];
              const isBench = index >= lineup.starters.length;
              const price = priceRow(snapshot, id);
              return (
                <tr key={id} className={isBench ? (index === lineup.starters.length ? "bc-bench-row bc-bench-first" : "bc-bench-row") : undefined}>
                  <td className="bc-cell-pos">{isBench ? "SUB" : player.position}</td>
                  <td className="bc-cell-name"><PlayerLink id={id} name={player.name} /></td>
                  <td className="muted">{player.team}</td>
                  <td className="right bc-cell-num">{formatPrice(player.price)}</td>
                  <td className={player.windowXp >= bestWindowXp - 1 ? "right bc-cell-num bc-cell-strong bc-accent" : "right bc-cell-num bc-cell-strong"}>
                    {formatXp(player.windowXp)}
                  </td>
                  <td><Sparkline points={player.form} /></td>
                  <td>
                    <span className="bc-fixtures">
                      {nextFixtures(snapshot, player, 3).map((fixture, chipIndex) => (
                        <span key={chipIndex} className={`bc-fixture level-${fixture.difficulty}`}>{fixture.label}</span>
                      ))}
                    </span>
                  </td>
                  <td className="right"><PriceChange progress={price?.progress ?? 0} likelihood={price?.likelihood ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// "▲ 100%" plus a TONIGHT tag when FPL expects the change at the next 00:00.
function PriceChange({ progress, likelihood }: { progress: number; likelihood: number }) {
  if (Math.round(progress) === 0) return <span className="bc-cell-num muted">0%</span>;
  const rising = progress > 0;
  const tonight = Math.abs(likelihood) >= 5;
  const tone = tonight ? (rising ? "bc-accent" : "bc-warn") : progress < 0 ? "bc-warn" : "muted";
  return (
    <span className="bc-price-change">
      <span className={`bc-cell-num ${tone}`}>
        {rising ? "▲" : "▼"} {Math.abs(progress).toFixed(0)}%
      </span>
      {tonight && <span className={rising ? "bc-tag" : "bc-tag bc-tag-warn"}>TONIGHT</span>}
    </span>
  );
}
