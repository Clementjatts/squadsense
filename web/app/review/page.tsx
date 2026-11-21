// Gameweek review: last week's result next to what the model expected.
// Server-rendered; nothing here is interactive except the player links.

import { PageHero, type HeroFigure } from "@/components/PageHero";
import { PlayerLink } from "@/components/PlayerPanel";
import { formatXp } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";
import type { GameweekReview, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { snapshot } = await getSnapshot();
  const review = snapshot.review;
  if (!review) {
    return (
      <div className="bc-page">
        <PageHero eyebrow="NO GAMEWEEK FINISHED YET" title="GAMEWEEK REVIEW" subtitle="The review appears once the first gameweek's points are final." />
      </div>
    );
  }
  return (
    <div className="bc-page">
      <PageHero
        eyebrow={`GW${review.gameweek} · POINTS FINAL`}
        title="GAMEWEEK REVIEW"
        subtitle="How last week went, and how close the model's expected points came."
        figures={heroFigures(review)}
      />
      <div className="row">
        <div className="col-wide" style={{ flex: "1.3 1 600px" }}>
          {review.team ? <TeamWeek review={review} snapshot={snapshot} /> : <NotStarted gameweek={review.gameweek} />}
        </div>
        <div className="col-narrow" style={{ flex: "1 1 380px" }}>
          <AcrossFpl review={review} snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}

// Your points against the average when your team played, the league-wide numbers otherwise.
function heroFigures(review: GameweekReview): HeroFigure[] {
  const average = { label: "FPL average", value: review.average ?? "-" };
  if (!review.team) return [average, { label: "Highest", value: review.highest ?? "-" }];
  const team = review.team;
  const rankMove = team.previousRank ? team.previousRank - team.overallRank : null;
  return [
    { label: "Your points", value: team.points - team.transferCost, accent: true },
    average,
    { label: "Rank move", value: rankMove === null ? "-" : `${rankMove >= 0 ? "▲" : "▼"} ${Math.abs(rankMove).toLocaleString("en-GB")}` },
  ];
}

function NotStarted({ gameweek }: { gameweek: number }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Your week</h2></div>
      <p className="muted" style={{ margin: 0 }}>
        Your team hadn&apos;t started in GW{gameweek}. Your own review, with captain choice and xP against points, appears after your first gameweek is played.
      </p>
    </section>
  );
}

// Captain choice, bench and hits, then each starter's xP against his points.
function TeamWeek({ review, snapshot }: { review: GameweekReview; snapshot: Snapshot }) {
  const team = review.team!;
  const name = (playerId: number) => snapshot.players[String(playerId)]?.name ?? `#${playerId}`;
  const captainGap = team.bestCaptain.points - team.captain.points;
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Your week</h2>{team.chip && <span className="bc-tag">{team.chip.toUpperCase()}</span>}</div>
        <div className="summary-grid">
          <div>
            <span className="muted">Captain</span>
            <b>{name(team.captain.playerId)} · {team.captain.points}</b>
          </div>
          <div>
            <span className="muted">Best captain in your XI</span>
            <b className={captainGap > 0 ? "bc-warn" : "bc-accent"}>
              {captainGap > 0 ? `${name(team.bestCaptain.playerId)} · +${captainGap}` : "You picked him"}
            </b>
          </div>
          <div>
            <span className="muted">Left on the bench</span>
            <b className="num">{team.benchPoints}</b>
          </div>
          <div>
            <span className="muted">Hits</span>
            <b className="num">{team.transferCost === 0 ? "0" : `-${team.transferCost}`}</b>
          </div>
        </div>
      </section>
      <section className="bc-card bc-table-card">
        <div className="table-wrap">
          <table className="bc-table" style={{ minWidth: 520 }}>
            <colgroup>
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">STARTER</th>
                <th scope="col" className="right">xP</th>
                <th scope="col" className="right">POINTS</th>
                <th scope="col" className="right">DIFFERENCE</th>
              </tr>
            </thead>
            <tbody>
              {team.starters.map((line) => {
                const gap = line.xp === null ? null : line.points - line.xp;
                return (
                  <tr key={line.playerId}>
                    <td className="bc-cell-name"><PlayerLink id={line.playerId} name={name(line.playerId)} /></td>
                    <td className="right bc-cell-num">{line.xp === null ? "-" : formatXp(line.xp)}</td>
                    <td className="right bc-cell-num bc-cell-strong">{line.points}</td>
                    <td className={`right bc-cell-num ${gap === null ? "muted" : gap >= 0 ? "bc-accent" : "bc-warn"}`}>
                      {gap === null ? "-" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {team.predictedTotal !== null && (
        <p className="bc-note">
          The model expected {formatXp(team.predictedTotal)} from this lineup, captain counted twice. Single weeks swing a lot; the backtest
          judges the model over hundreds of matches.
        </p>
      )}
    </>
  );
}

// The week for everyone: most captained player and the top scorers.
function AcrossFpl({ review, snapshot }: { review: GameweekReview; snapshot: Snapshot }) {
  const name = (playerId: number) => snapshot.players[String(playerId)]?.name ?? `#${playerId}`;
  return (
    <section className="card">
      <div className="card-head"><h2>Across FPL</h2><span className="muted">Highest score {review.highest ?? "-"}</span></div>
      {review.mostCaptained && (
        <div className="summary-grid">
          <div>
            <span className="muted">Most captained</span>
            <b>{name(review.mostCaptained.playerId)} · {review.mostCaptained.points}</b>
          </div>
        </div>
      )}
      <ul className="share-list">
        {review.topPlayers.map((line, index) => (
          <li key={line.playerId} className="review-top-row">
            <span className="muted num">{index + 1}</span>
            <span className="share-name"><PlayerLink id={line.playerId} name={name(line.playerId)} /></span>
            <span className="muted">{snapshot.players[String(line.playerId)]?.team ?? ""}</span>
            <b className="num">{line.points}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
