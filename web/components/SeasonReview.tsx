// "Season so far" on the Review page: totals for every finished week since
// your team started, a bar per week (your points, with the FPL average
// marked), and a table with rank, bench points and captain choice.
// Server-rendered; nothing here is interactive.

import { formatXp } from "@/lib/format";
import type { SeasonReview as SeasonData, SeasonWeek } from "@/lib/types";

export function SeasonReview({ season }: { season: SeasonData }) {
  if (season.weeks.length === 0) return null;
  return (
    <>
      <div className="bc-section-head">
        <span className="bc-section-slash" aria-hidden="true" />
        <div>
          <h2 className="bc-section-title">SEASON SO FAR</h2>
          <p className="bc-note">Every finished week since your team started</p>
        </div>
      </div>
      <SeasonTotals season={season} />
      <PointsChart weeks={season.weeks} />
      <SeasonTable weeks={season.weeks} />
    </>
  );
}

// Four headline tiles, plus how the saved forecasts compare with what happened.
function SeasonTotals({ season }: { season: SeasonData }) {
  const { totals, weeks } = season;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const rankMove = first.overallRank - last.overallRank;
  return (
    <section className="card">
      <div className="summary-grid season-totals">
        <div>
          <span className="muted">Points (after hits)</span>
          <b className="num">{totals.points}</b>
        </div>
        <div>
          <span className="muted">Weeks above average</span>
          <b className="num">{totals.aboveAverage} of {totals.weeks}</b>
        </div>
        <div>
          <span className="muted">Left on the bench</span>
          <b className="num">{totals.benchPoints}</b>
        </div>
        <div>
          <span className="muted">Captain right</span>
          <b className="num">{totals.captainWeeks === 0 ? "-" : `${totals.captainRight} of ${totals.captainWeeks}`}</b>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Overall rank {last.overallRank.toLocaleString("en-GB")}
        {weeks.length > 1 && (
          <> ({rankMove >= 0 ? "up" : "down"} {Math.abs(rankMove).toLocaleString("en-GB")} since GW{first.gameweek})</>
        )}
        . Hits cost {totals.transferCost}. A different captain in your eleven would have added {totals.captainLost} points.
        {totals.forecastWeeks > 0 && (
          <> In the {totals.forecastWeeks} week{totals.forecastWeeks === 1 ? "" : "s"} with a saved forecast, the model expected{" "}
            {formatXp(totals.forecastPredicted)} and you scored {totals.forecastActual}.</>
        )}
      </p>
    </section>
  );
}

// One bar per week, scaled to the season's best week, with a tick at the FPL average.
function PointsChart({ weeks }: { weeks: SeasonWeek[] }) {
  const top = Math.max(...weeks.map((week) => Math.max(week.points, week.average ?? 0)), 1);
  const percent = (value: number) => `${Math.max(0, (value / top) * 100)}%`;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Points each week</h2>
        <span className="muted">Line marks the FPL average</span>
      </div>
      <div className="season-chart" role="img" aria-label={weeks.map((week) => `GW${week.gameweek} ${week.points} points, average ${week.average ?? "unknown"}`).join("; ")}>
        {weeks.map((week) => (
          <div key={week.gameweek} className="season-chart-col">
            <span className="season-chart-value num">{week.points}</span>
            <div className="season-chart-track">
              <div className={week.average !== null && week.points > week.average ? "season-chart-bar above" : "season-chart-bar"} style={{ height: percent(week.points) }} />
              {week.average !== null && <div className="season-chart-average" style={{ bottom: percent(week.average) }} />}
            </div>
            <span className="season-chart-label">{week.gameweek}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Every week in a row: points against average and forecast, rank, bench and captain.
function SeasonTable({ weeks }: { weeks: SeasonWeek[] }) {
  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className="bc-table review-table season-table">
          <thead>
            <tr>
              <th scope="col">GW</th>
              <th scope="col" className="right">POINTS</th>
              <th scope="col" className="right">AVERAGE</th>
              <th scope="col" className="right">FORECAST</th>
              <th scope="col" className="right">RANK</th>
              <th scope="col" className="right">BENCH</th>
              <th scope="col" className="right">CAPTAIN LOST</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((week) => (
              <tr key={week.gameweek}>
                <td className="bc-cell-num">GW{week.gameweek}</td>
                <td className="right bc-cell-num bc-cell-strong">
                  {week.points}
                  {week.transferCost > 0 && <span className="bc-warn small"> (-{week.transferCost})</span>}
                </td>
                <td className="right bc-cell-num muted">{week.average ?? "-"}</td>
                <td className="right bc-cell-num muted">{week.predicted === null ? "-" : formatXp(week.predicted)}</td>
                <td className="right bc-cell-num">{week.overallRank.toLocaleString("en-GB")}</td>
                <td className="right bc-cell-num">{week.benchPoints}</td>
                <td className={`right bc-cell-num ${week.captainLost ? "bc-warn" : "muted"}`}>
                  {week.captainLost === null ? "-" : week.captainLost === 0 ? "0" : `-${week.captainLost}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
