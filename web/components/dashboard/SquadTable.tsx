// Squad analysis table: the detail behind the pitch. Value, five-week xP,
// FPL's own xP for next week, form, next three fixtures and price movement,
// one fixed-height row per player, starters first and then the bench.

import { formatPrice, formatXp } from "@/lib/format";
import { FPL_GAP_TO_FLAG, fplGap, nextFixtures, priceRow, setPieceTags, tableOrder } from "@/lib/dashboard";
import { changesTonight } from "@/lib/prices";
import type { Player, Snapshot } from "@/lib/types";
import { PlayerLink } from "../PlayerPanel";
import { Sparkline } from "./Sparkline";

export function SquadTable({ snapshot }: { snapshot: Snapshot }) {
  const lineup = snapshot.lineups[String(snapshot.gameweek)];
  const ids = tableOrder(lineup.starters, lineup.bench, snapshot.players);
  const bestWindowXp = Math.max(...ids.map((id) => snapshot.players[String(id)].windowXp));

  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className="bc-table squad-table" style={{ minWidth: 880 }}>
          <colgroup>
            <col style={{ width: 58 }} />
            <col />
            <col style={{ width: 56 }} />
            <col style={{ width: 84 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 176 }} />
            <col style={{ width: 124 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">POS</th>
              <th scope="col">PLAYER</th>
              <th scope="col">CLUB</th>
              <th scope="col" className="right">PRICE</th>
              <th scope="col" className="right">xP {snapshot.weeks.length} GW</th>
              <th scope="col" className="right" title="FPL's own expected points for next week, as a second opinion">FPL GW{snapshot.gameweek}</th>
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
                  <td className="bc-cell-name">
                    <PlayerLink id={id} name={player.name} />
                    {setPieceTags(player).map((tag) => <span key={tag} className="bc-set-tag">{tag}</span>)}
                  </td>
                  <td className="muted">{player.team}</td>
                  <td className="right bc-cell-num">{formatPrice(player.price)}</td>
                  <td className={player.windowXp >= bestWindowXp - 1 ? "right bc-cell-num bc-cell-strong bc-accent" : "right bc-cell-num bc-cell-strong"}>
                    {formatXp(player.windowXp)}
                  </td>
                  <td className="right"><FplOpinion player={player} week={snapshot.gameweek} /></td>
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

// FPL's number for next week, lit up when it differs a lot from ours:
// lime when FPL rates him higher, orange when lower.
function FplOpinion({ player, week }: { player: Player; week: number }) {
  const gap = fplGap(player, week);
  if (gap === null || player.fplXp === null) return <span className="bc-cell-num muted">-</span>;
  const tone = gap <= -FPL_GAP_TO_FLAG ? "bc-accent" : gap >= FPL_GAP_TO_FLAG ? "bc-warn" : "muted";
  const hint = Math.abs(gap) >= FPL_GAP_TO_FLAG ? `FPL says ${formatXp(player.fplXp)}, we say ${formatXp(player.fplXp + gap)}` : undefined;
  return <span className={`bc-cell-num ${tone}`} title={hint}>{formatXp(player.fplXp)}</span>;
}

// "▲ 100%" plus a TONIGHT tag when FPL expects the change at the next 00:00.
function PriceChange({ progress, likelihood }: { progress: number; likelihood: number }) {
  if (Math.round(progress) === 0) return <span className="bc-cell-num muted">0%</span>;
  const rising = progress > 0;
  const tonight = changesTonight(likelihood);
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
