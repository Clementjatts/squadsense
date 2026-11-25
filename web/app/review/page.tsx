// Gameweek review: last week's result next to what the model expected.
// Built in rows whose cards end on the same line: your team on the pitch
// beside your decisions; expected against scored beside the week across
// FPL; then the season so far at full width.

import { PageHero, type HeroFigure } from "@/components/PageHero";
import { PlayerLink } from "@/components/PlayerPanel";
import { SeasonReview } from "@/components/SeasonReview";
import { ReviewPitch } from "@/components/review/ReviewPitch";
import { formatXp } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";
import type { GameweekReview, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

type ReviewTeam = NonNullable<GameweekReview["team"]>;

const CHIP_NAMES: Record<string, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

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
        subtitle="How your week went, and how close the model's expected points came."
        figures={heroFigures(review)}
      />
      {review.team ? (
        <>
          <div className="bc-row bc-row-wide">
            <ReviewPitch review={review} players={snapshot.players} />
            <Decisions team={review.team} snapshot={snapshot} />
          </div>
          <div className="bc-row bc-row-2">
            <ExpectedVsScored team={review.team} snapshot={snapshot} />
            <AcrossFpl review={review} snapshot={snapshot} />
          </div>
        </>
      ) : (
        <div className="bc-row bc-row-2">
          <NotStarted gameweek={review.gameweek} />
          <AcrossFpl review={review} snapshot={snapshot} />
        </div>
      )}
      {review.season && <SeasonReview season={review.season} />}
    </div>
  );
}

// Your points after hits and the average, then your rank move (or your rank in your first week).
function heroFigures(review: GameweekReview): HeroFigure[] {
  const average = { label: "FPL average", value: review.average ?? "-" };
  if (!review.team) return [average, { label: "Highest", value: review.highest ?? "-" }];
  const team = review.team;
  const rankMove = team.previousRank ? team.previousRank - team.overallRank : null;
  const rankFigure = rankMove === null
    ? { label: "Overall rank", value: shortRank(team.overallRank) }
    : { label: "Rank move", value: `${rankMove >= 0 ? "▲" : "▼"} ${shortRank(Math.abs(rankMove))}` };
  return [{ label: "Your points", value: team.points - team.transferCost, accent: true }, average, rankFigure];
}

// A rank short enough for a hero figure: 11,199,860 as "11.2M", 48,210 as "48.2K".
function shortRank(rank: number): string {
  if (rank >= 1_000_000) return `${(rank / 1_000_000).toFixed(1)}M`;
  if (rank >= 10_000) return `${(rank / 1_000).toFixed(1)}K`;
  return rank.toLocaleString("en-GB");
}

function NotStarted({ gameweek }: { gameweek: number }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Your week</h2></div>
      <p className="muted" style={{ margin: 0 }}>
        Your team hadn&apos;t started in GW{gameweek}. Your own review, with your team on the pitch and your captain choice, appears after your first gameweek is played.
      </p>
    </section>
  );
}

interface DecisionProps {
  label: string;
  verdict: string;
  tone: "good" | "short" | "plain";
  headline: string;
  detail: string;
}

// One decision tile: what it was, a verdict in points, and one line of explanation.
function Decision({ label, verdict, tone, headline, detail }: DecisionProps) {
  return (
    <div className="review-decision">
      <div className="review-decision-top">
        <span className="muted">{label}</span>
        <b className={`review-decision-verdict review-tone-${tone}`}>{verdict}</b>
      </div>
      <span className="review-decision-headline">{headline}</span>
      <span className="review-decision-detail">{detail}</span>
    </div>
  );
}

// Captain, chip, transfers and the model's forecast: four tiles that fill the height of the pitch beside them.
function Decisions({ team, snapshot }: { team: ReviewTeam; snapshot: Snapshot }) {
  return (
    <section className="card review-decisions">
      <div className="card-head"><h2>Your decisions</h2></div>
      <div className="review-decision-list">
        <CaptainDecision team={team} snapshot={snapshot} />
        <ChipDecision team={team} snapshot={snapshot} />
        <Decision
          label="Transfers"
          verdict={team.transferCost === 0 ? "0" : `−${team.transferCost}`}
          tone={team.transferCost === 0 ? "plain" : "short"}
          headline={team.transferCost === 0 ? "No hits taken" : `${team.transferCost / 4} extra transfer${team.transferCost === 4 ? "" : "s"}`}
          detail={team.transferCost === 0 ? "Every transfer this week was free." : `The hits cost ${team.transferCost} points.`}
        />
        <ForecastDecision team={team} />
      </div>
    </section>
  );
}

// Your captain against the best captain your starting eleven offered.
function CaptainDecision({ team, snapshot }: { team: ReviewTeam; snapshot: Snapshot }) {
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;
  const multiplier = team.chip === "3xc" ? 3 : 2;
  const lost = (team.bestCaptain.points - team.captain.points) * (multiplier - 1);
  const captainEarned = team.captain.points * multiplier;
  return (
    <Decision
      label="Captain"
      verdict={lost > 0 ? `−${lost}` : "Best pick"}
      tone={lost > 0 ? "short" : "good"}
      headline={`${name(team.captain.playerId)} · ${captainEarned} pts`}
      detail={lost > 0
        ? `${name(team.bestCaptain.playerId)} was your best option with ${team.bestCaptain.points}. Captaining him would have added ${lost}.`
        : "No one in your starting eleven scored more."}
    />
  );
}

// The chip you played and what it added, or that none was played.
function ChipDecision({ team, snapshot }: { team: ReviewTeam; snapshot: Snapshot }) {
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;
  if (!team.chip) {
    return <Decision label="Chip" verdict="None" tone="plain" headline="No chip played" detail="Your chips are still there for later weeks." />;
  }
  if (team.chip === "bboost") {
    const bench = team.bench ?? [];
    const added = bench.reduce((sum, line) => sum + line.points, 0);
    return (
      <Decision
        label="Bench Boost"
        verdict={`+${added}`}
        tone={added > 0 ? "good" : "short"}
        headline={`Bench scored ${added}`}
        detail={bench.length > 0 ? bench.map((line) => `${name(line.playerId)} ${line.points}`).join(", ") + "." : "Your bench's points counted this week."}
      />
    );
  }
  if (team.chip === "3xc") {
    return (
      <Decision label="Triple Captain" verdict={`+${team.captain.points}`} tone={team.captain.points > 0 ? "good" : "short"}
        headline={`${name(team.captain.playerId)} tripled`} detail={`The third helping of his ${team.captain.points} points.`} />
    );
  }
  return <Decision label={CHIP_NAMES[team.chip] ?? team.chip} verdict="Played" tone="plain" headline={`${CHIP_NAMES[team.chip] ?? team.chip} played`} detail="Its value shows in the transfers it allowed." />;
}

// What the model expected from your lineup against what it scored.
function ForecastDecision({ team }: { team: ReviewTeam }) {
  if (team.predictedTotal === null) {
    return <Decision label="Model's forecast" verdict="-" tone="plain" headline="No forecast saved" detail="The sync hadn't saved a forecast before this deadline." />;
  }
  const scored = team.points;
  const gap = Math.round(scored - team.predictedTotal);
  return (
    <Decision
      label="Model's forecast"
      verdict={`${gap >= 0 ? "+" : "−"}${Math.abs(gap)}`}
      tone={gap >= 0 ? "good" : "short"}
      headline={`Expected ${formatXp(team.predictedTotal)}, scored ${scored}`}
      detail="Single weeks swing a lot. The backtest judges the model over hundreds of matches."
    />
  );
}

// Each player's points minus his expected points, largest gain first, as bars either side of zero.
function ExpectedVsScored({ team, snapshot }: { team: ReviewTeam; snapshot: Snapshot }) {
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;
  const benchCounted = team.chip === "bboost";
  const lines = [...team.starters, ...(benchCounted ? team.bench ?? [] : [])]
    .filter((line) => line.xp !== null)
    .map((line) => ({ id: line.playerId, gap: line.points - (line.xp ?? 0) }))
    .sort((a, b) => b.gap - a.gap);
  const widest = Math.max(6, ...lines.map((line) => Math.abs(line.gap)));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Expected vs scored</h2>
        <span className="muted">Points minus expected points{benchCounted ? ", bench included" : ""}</span>
      </div>
      {lines.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No forecast was saved for this week, so there&apos;s nothing to compare.</p>
      ) : (
        <ul className="review-gaps">
          {lines.map((line) => {
            const half = (Math.abs(line.gap) / widest) * 50;
            const good = line.gap >= 0;
            return (
              <li key={line.id} className="review-gap-row">
                <span className="review-gap-name"><PlayerLink id={line.id} name={name(line.id)} /></span>
                <span className="review-gap-track" aria-hidden="true">
                  <span className={`review-gap-bar review-tone-bg-${good ? "good" : "short"}`} style={{ left: good ? "50%" : `${50 - half}%`, width: `${half}%` }} />
                </span>
                <b className={`num review-tone-${good ? "good" : "short"}`}>{good ? "+" : "−"}{Math.abs(line.gap).toFixed(1)}</b>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The week for everyone: highest score, average, most captained and FPL's top scorers.
function AcrossFpl({ review, snapshot }: { review: GameweekReview; snapshot: Snapshot }) {
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;
  return (
    <section className="card">
      <div className="card-head"><h2>Across FPL</h2></div>
      <div className="summary-grid">
        <div><span className="muted">Highest score</span><b className="num">{review.highest ?? "-"}</b></div>
        <div><span className="muted">Average</span><b className="num">{review.average ?? "-"}</b></div>
        <div><span className="muted">Most captained</span><b>{review.mostCaptained ? name(review.mostCaptained.playerId) : "-"}</b></div>
      </div>
      <span className="muted review-top-title">Top scorers this week</span>
      <ol className="review-top-list">
        {review.topPlayers.map((line, index) => (
          <li key={line.playerId} className="review-top-row">
            <span className="muted num">{index + 1}</span>
            <span className="share-name"><PlayerLink id={line.playerId} name={name(line.playerId)} /></span>
            <span className="muted">{snapshot.players[String(line.playerId)]?.team ?? ""}</span>
            <b className="num">{line.points}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
