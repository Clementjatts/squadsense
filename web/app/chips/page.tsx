// Chip Planner: a season strip showing chips played and recommended, and
// one card per chip with its best week and expected gain. Nothing here is
// interactive, so it renders entirely on the server.

import { TopBar } from "@/components/TopBar";
import { formatGain } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";
import type { ChipCard, ChipPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChipsPage() {
  const { snapshot } = await getSnapshot();
  const plan = snapshot.chipPlan;
  return (
    <>
      <TopBar title="Chip Planner" subtitle="When to play each chip" snapshot={snapshot} />
      <div className="content">
        <SeasonTimeline plan={plan} />
        <div className="chip-cards">
          {plan.cards.map((card) => (
            <ChipCardView key={card.chip} card={card} />
          ))}
        </div>
        <p className="muted small">
          FPL allows one chip per gameweek, so the plan never puts two in the same week. Gains assume you keep your
          current squad and use the model&apos;s expected points, which are still untested guesses.
        </p>
      </div>
    </>
  );
}

// "Sat 2 Jan, 13:30" in UK time, for the end of the chip window.
function formatWindowDeadline(isoTime: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  }).format(new Date(isoTime));
}

// The 38-week strip. Played chips are grey, recommended weeks lime, this
// week is outlined and a gap marks the end of the first half.
function SeasonTimeline({ plan }: { plan: ChipPlan }) {
  const isFirstHalf = plan.halfStart === 1;
  const half = isFirstHalf ? "first-half" : "second-half";
  // The week where the second set of chips starts, from FPL's chip windows.
  const gapWeek = isFirstHalf ? plan.halfStop + 1 : plan.halfStart;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Season timeline</h2>
        <span className="muted">
          {plan.weeksLeft} gameweeks left to use {plan.chipsLeft} {half} chips (deadline {formatWindowDeadline(plan.halfDeadline)})
        </span>
      </div>
      <div className="chip-timeline">
        {plan.timeline.map((week) => {
          const classes = ["chip-week"];
          if (week.recommended.length > 0) classes.push("recommended");
          else if (week.used.length > 0) classes.push("used");
          if (week.gameweek < plan.currentWeek) classes.push("past");
          if (week.gameweek === plan.currentWeek) classes.push("current");
          if (week.gameweek === gapWeek) classes.push("half-gap");
          return (
            <div key={week.gameweek} className={classes.join(" ")}>
              <div className="chip-week-box">{[...week.used, ...week.recommended].join(" ")}</div>
              <span>{week.gameweek}</span>
            </div>
          );
        })}
      </div>
      <div className="ticker-key">
        <span>
          <i className="swatch recommended" aria-hidden="true" /> Recommended
        </span>
        <span>
          <i className="swatch used" aria-hidden="true" /> Played
        </span>
        <span className="muted">Outlined = this week (GW{plan.currentWeek}) · gap after GW{gapWeek - 1} = end of the first half</span>
      </div>
    </section>
  );
}

function ChipCardView({ card }: { card: ChipCard }) {
  const bestWeek = card.status === "used" ? "Second half" : card.bestWeek === null ? "None yet" : `GW${card.bestWeek}`;
  return (
    <section className={`card chip-card ${card.status}`}>
      <div className="card-head">
        <h2>{card.label}</h2>
        <span className={card.status === "available" ? "chip good" : "chip"}>
          {card.status === "available" ? "Available" : `Played GW${card.usedIn}`}
        </span>
      </div>
      <div className="chip-card-stats">
        <span>
          <span className="muted">Best week</span>
          <b className="num">{bestWeek}</b>
        </span>
        <span>
          <span className="muted">Expected gain</span>
          <b className="num">{card.gain === null ? "n/a" : `${formatGain(card.gain)} xP`}</b>
        </span>
      </div>
      <span className="muted">{card.reason}</span>
    </section>
  );
}
