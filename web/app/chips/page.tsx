// Chip Planner: a season strip showing chips played and recommended, and
// one card per chip with its best week and expected gain. Nothing here is
// interactive, so it renders entirely on the server.

import { PageHero } from "@/components/PageHero";
import { RivalChipsCard } from "@/components/RivalChipsCard";
import { formatGain } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";
import type { ChipCard, ChipPlan, FixtureWarnings, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChipsPage() {
  const { snapshot } = await getSnapshot();
  const plan = snapshot.chipPlan;
  const half = plan.halfStart === 1 ? "first-half" : "second-half";
  return (
    <div className="bc-page">
      <PageHero
        eyebrow={`${half.toUpperCase()} CHIPS EXPIRE ${formatWindowDeadline(plan.halfDeadline).toUpperCase()}`}
        title="CHIP PLANNER"
        subtitle="When to play each chip. FPL allows one per gameweek, so the plan never puts two in the same week."
        figures={[
          { label: "Chips left", value: plan.chipsLeft, accent: true },
          { label: "Gameweeks left", value: plan.weeksLeft },
        ]}
      />
      <SeasonTimeline plan={plan} />
      <div className="chip-cards">
        {plan.cards.map((card) => (
          <ChipCardView key={card.chip} card={card} plan={plan} snapshot={snapshot} />
        ))}
      </div>
      <div className="row">
        <div className="col-wide" style={{ flex: "1 1 520px" }}>
          <FixtureWarningsCard warnings={plan.fixtureWarnings} />
        </div>
        <div className="col-narrow" style={{ flex: "1 1 520px" }}>
          {plan.rivals.length > 0 && <RivalChipsCard rivals={plan.rivals} />}
        </div>
      </div>
      <p className="bc-note">
        Gains assume you keep your current squad and use the model&apos;s expected points; the Wildcard compares a rebuilt squad with
        making no transfers. &quot;Play now&quot; means this week is worth at least 90% of the best week left, the rule that did best in
        the chip backtest. In that test Bench Boost still did better on the first double gameweek, so give a known double extra weight.
      </p>
    </div>
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
  // The week where the second set of chips starts, from FPL's chip windows.
  const gapWeek = isFirstHalf ? plan.halfStop + 1 : plan.halfStart;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Season timeline</h2>
      </div>
      <div className="chip-timeline">
        {plan.timeline.map((week) => {
          const classes = ["chip-week"];
          if (week.recommended.length > 0) classes.push("recommended");
          else if (week.used.length > 0) classes.push("used");
          if (week.gameweek < plan.currentWeek) classes.push("past");
          if (week.gameweek === plan.currentWeek) classes.push("current");
          if (week.gameweek === gapWeek) classes.push("half-gap");
          if (week.quality === "far") classes.push("far");
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
        <span>
          <i className="swatch far" aria-hidden="true" /> Rougher estimate (beyond the next five gameweeks)
        </span>
        <span className="muted">Outlined = this week (GW{plan.currentWeek}) · gap after GW{gapWeek - 1} = end of the first half</span>
      </div>
    </section>
  );
}

// The badge in each card's corner: play now, wait, or already played.
function statusBadge(card: ChipCard): { text: string; className: string } {
  if (card.status === "used") return { text: `Played GW${card.usedIn}`, className: "chip" };
  if (card.timing?.advice === "play") return { text: "Play now", className: "chip good" };
  if (card.timing) return { text: "Wait", className: "chip" };
  return { text: "Available", className: "chip" };
}

// One short line on how risky the chip is, in that chip's own terms.
function riskLine(card: ChipCard, snapshot: Snapshot): string | null {
  const risk = card.risk;
  if (risk.haulChance !== undefined) {
    const captain = risk.captainId ? snapshot.players[String(risk.captainId)]?.name : undefined;
    return `${captain ?? "Captain"}: ${Math.round(risk.haulChance * 100)}% chance of 10+ (30+ tripled), ${Math.round((risk.blankChance ?? 0) * 100)}% of 2 or fewer`;
  }
  if (risk.allBenchPlay !== undefined) return `${Math.round(risk.allBenchPlay * 100)}% chance all four bench players get on`;
  if (risk.changes !== undefined) return `${risk.changes} of your 15 would change`;
  return null;
}

// "This week +6.9 · best week GW16 +7.1", or null when there's no best week.
function timingLine(card: ChipCard): string | null {
  if (!card.timing || card.bestWeek === null) return null;
  const { nowGain, peakWeek, peakGain } = card.timing;
  const now = nowGain === null ? "Not playable this week" : `This week ${formatGain(nowGain)}`;
  // When this week is the best week, there's nothing to compare it with.
  return nowGain !== null && peakGain <= nowGain ? now : `${now} · best week GW${peakWeek} ${formatGain(peakGain)}`;
}

function ChipCardView({ card, plan, snapshot }: { card: ChipCard; plan: ChipPlan; snapshot: Snapshot }) {
  const bestWeek = card.status === "used" ? "Second half" : card.bestWeek === null ? "None yet" : `GW${card.bestWeek}`;
  const badge = statusBadge(card);
  const withTransfers = plan.withTransfers[card.chip];
  const risk = riskLine(card, snapshot);
  const timing = timingLine(card);
  return (
    <section className={`card chip-card ${card.status}`}>
      <div className="card-head">
        <h2>{card.label}</h2>
        <span className={badge.className}>{badge.text}</span>
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
      {card.byWeek.length > 0 && <WeekBars card={card} />}
      <div className="chip-card-lines">
        {timing && <span>{timing}</span>}
        {risk && <span>{risk}</span>}
        {withTransfers !== undefined && <span className="bc-accent">The five-week transfer plan plays it in GW{withTransfers}</span>}
        {card.quality === "far" && <span className="bc-warn">GW{card.bestWeek} is outside the next five gameweeks, so this is a rougher estimate</span>}
      </div>
      <span className="muted">{card.reason}</span>
    </section>
  );
}

// A small bar per remaining week of the half, tallest = best week. Fixed height so cards line up.
function WeekBars({ card }: { card: ChipCard }) {
  const top = Math.max(...card.byWeek.map((week) => week.gain), 0.1);
  return (
    <div className="chip-bars" aria-label={`${card.label} expected gain by gameweek`}>
      {card.byWeek.map((week) => (
        <span key={week.gameweek} className="chip-bar-slot" title={`GW${week.gameweek}: ${formatGain(week.gain)} xP`}>
          <span
            className={week.gameweek === card.bestWeek ? "chip-bar best" : "chip-bar"}
            style={{ height: `${Math.max(4, (Math.max(week.gain, 0) / top) * 100)}%` }}
          />
          <span className="chip-bar-label">{week.gameweek}</span>
        </span>
      ))}
    </div>
  );
}

// Known blank and double gameweeks, matches waiting for a date, and kick-offs not yet confirmed.
function FixtureWarningsCard({ warnings }: { warnings: FixtureWarnings }) {
  const nothing = warnings.weeks.length === 0 && warnings.unscheduled.length === 0 && warnings.provisional.length === 0;
  return (
    <section className="card">
      <div className="card-head"><h2>Blanks and doubles</h2><span className="muted">Rest of this half</span></div>
      {nothing && <p className="muted" style={{ margin: 0 }}>No blank or double gameweeks known yet, and every match has a date.</p>}
      <ul className="share-list">
        {warnings.weeks.map((week) => (
          <li key={week.gameweek} className="fixture-warning-row">
            <b className="num">GW{week.gameweek}</b>
            <span>
              {week.doubles.length > 0 && <span className="bc-accent">Double: {week.doubles.join(", ")}</span>}
              {week.doubles.length > 0 && week.blanks.length > 0 && " · "}
              {week.blanks.length > 0 && <span className="bc-warn">Blank: {week.blanks.join(", ")}</span>}
            </span>
          </li>
        ))}
      </ul>
      {warnings.unscheduled.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Waiting for a new date (each will make a double for both clubs): {warnings.unscheduled.join(", ")}.
        </p>
      )}
      {warnings.provisional.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Kick-off not confirmed: {warnings.provisional.map((item) => `${item.match} (GW${item.gameweek})`).join(", ")}.
        </p>
      )}
    </section>
  );
}
