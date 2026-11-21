// "Your plan explained": the five-week plan in full, so a big decision
// (a Wildcard, a Free Hit, a hit) is never just one line on the Planner.
// It shows the decision, why each chip is played or saved, every transfer
// with both players' numbers, chip-week squads, the no-chip alternative,
// and how sure the model is. Everything comes from the one strategy in
// jobs/squadsense/strategy.py.

import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { PlayerLink } from "@/components/PlayerPanel";
import { formatGain, formatPrice, formatXp } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";
import type { ChipCard, ChipCode, Player, SolverPlan, SolverWeek, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

const CHIP_LABELS: Record<ChipCode, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };
const FIXTURES_SHOWN = 3;

export default async function PlanPage() {
  const { snapshot } = await getSnapshot();
  const plan = snapshot.solverPlan;
  if (!plan) {
    return (
      <div className="bc-page">
        <PageHero eyebrow="FIVE-WEEK PLAN" title="YOUR PLAN EXPLAINED" subtitle="There's no transfer plan yet: it needs your real squad, which shows once your first deadline has passed." />
      </div>
    );
  }
  const weeks = plan.weeks.map((week) => week.gameweek);
  const hits = plan.totalHits * 4;
  return (
    <div className="bc-page">
      <PageHero
        eyebrow={`GW${weeks[0]} TO GW${weeks[weeks.length - 1]}`}
        title="YOUR PLAN EXPLAINED"
        subtitle="What the plan does, why, and what you'd get instead. Later weeks count 10% less each, because they're less certain."
        figures={[
          { label: "vs making no moves", value: `${formatGain(plan.gain)} xP`, accent: true },
          { label: "vs normal transfers only", value: `${formatGain(plan.gain - plan.normalTransfers.gain)} xP` },
          { label: "Points hit", value: hits === 0 ? "0" : `-${hits}` },
        ]}
      />
      <DecisionSummary plan={plan} snapshot={snapshot} />
      <ChipReasons snapshot={snapshot} plan={plan} />
      {plan.weeks.map((week, index) => (
        <WeekDetail key={week.gameweek} week={week} before={index === 0 ? snapshot.squad : plan.weeks[index - 1].squad} snapshot={snapshot} />
      ))}
      <Alternative plan={plan} snapshot={snapshot} />
      <HowSure plan={plan} snapshot={snapshot} />
      <div className="plan-actions">
        <Link href="/planner" className="btn primary">Open in the Planner</Link>
        <span className="muted">In the Planner, &quot;Load into planner&quot; puts these moves and chips on the pitch, and you can change anything before applying.</span>
      </div>
    </div>
  );
}

const nameOf = (snapshot: Snapshot, id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;

// The week's moves by name ("Raya → Trafford"), or a count when there are many.
function moveList(week: SolverWeek, snapshot: Snapshot): string {
  if (week.moves.length === 0) return "no transfers (the free transfer rolls over)";
  if (week.moves.length > 3) return `${week.moves.length} transfers`;
  return week.moves.map((move) => `${nameOf(snapshot, move.out)} → ${nameOf(snapshot, move.in)}`).join(", ");
}

// One sentence for a week: "GW13: Triple Captain on Haaland, Raya → Trafford".
function weekSentence(week: SolverWeek, snapshot: Snapshot): string {
  const parts: string[] = [];
  if (week.chip === "freehit") parts.push("Free Hit: a one-week squad plays, your own squad comes back next week");
  else if (week.chip === "3xc") parts.push(`Triple Captain on ${nameOf(snapshot, week.captain)}`);
  else if (week.chip) parts.push(CHIP_LABELS[week.chip]);
  if (week.chip !== "freehit") parts.push(moveList(week, snapshot));
  if (week.hits > 0) parts.push(`-${week.hits * 4} hit`);
  return `GW${week.gameweek}: ${parts.join(", ")}`;
}

// The headline: where your squad stands and what the plan does each week.
function DecisionSummary({ plan, snapshot }: { plan: SolverPlan; snapshot: Snapshot }) {
  return (
    <section className="card">
      <div className="card-head"><h2>The decision</h2></div>
      <p className="plan-text">
        Over the next five gameweeks your squad is about <b>{formatXp(plan.gapToBest)} xP</b> short of the best squad you could afford.
        Your normal free transfers would close about <b>{Math.round(plan.normalShareOfGap * 100)}%</b> of that
        ({formatGain(plan.normalTransfers.gain)} xP).{" "}
        {Object.keys(plan.chips).length === 0
          ? "No chip beats saving it for later in the half, so the plan is your normal transfers, and every chip is kept."
          : `The plan does ${formatGain(plan.gain - plan.normalTransfers.gain)} xP better than normal transfers alone by also playing ${Object.entries(plan.chips).map(([chip, week]) => `${CHIP_LABELS[chip as ChipCode]} in GW${week}`).join(" and ")}, where that beats saving it.`}
      </p>
      <ul className="plan-weeks">
        {plan.weeks.map((week) => <li key={week.gameweek}>{weekSentence(week, snapshot)}</li>)}
      </ul>
    </section>
  );
}

// Every available chip: played or saved, what it adds, the value of saving it, and whether it's a close call.
function ChipReasons({ snapshot, plan }: { snapshot: Snapshot; plan: SolverPlan }) {
  const cards = snapshot.chipPlan.cards.filter((card) => card.status === "available");
  return (
    <section className="bc-card bc-table-card">
      <div className="plan-table-head">
        <h2>Chips: play or save</h2>
        <span className="muted">
          A chip is played in these five weeks only if it beats 90% of its best week later in the half. A Wildcard must also clear
          {" "}{plan.wildcardMargin} points, since it can&apos;t be undone. Within {plan.closeCallPoints} points is a close call.
        </span>
      </div>
      <div className="table-wrap">
        <table className="bc-table">
          <colgroup>
            <col style={{ width: 150 }} /><col style={{ width: 190 }} /><col style={{ width: 90 }} /><col style={{ width: 150 }} /><col />
          </colgroup>
          <thead>
            <tr><th scope="col">CHIP</th><th scope="col">DECISION</th><th scope="col" className="right">ADDS</th><th scope="col" className="right">SAVING IS WORTH</th><th scope="col">WHY</th></tr>
          </thead>
          <tbody>
            {cards.map((card) => <ChipRow key={card.chip} card={card} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChipRow({ card }: { card: ChipCard }) {
  const decision = card.decision!;
  const label = decision.action === "play" ? `Play GW${decision.week}` : decision.action === "save" ? `Save for GW${decision.week}` : "Not needed";
  return (
    <tr>
      <td className="bc-cell-name">{card.label}</td>
      <td className={decision.action === "play" ? "bc-accent plan-decision" : "plan-decision"}>
        {label}
        {decision.closeCall && <span className="bc-set-tag plan-close">CLOSE CALL</span>}
      </td>
      <td className="right bc-cell-num">{decision.gain === null ? "-" : formatGain(decision.gain)}</td>
      <td className="right bc-cell-num">{decision.keepValue === null ? "-" : formatGain(decision.keepValue)}</td>
      <td className="plan-why" title={card.reason}>{card.reason}</td>
    </tr>
  );
}

// His xP from `fromWeek` to the end of the plan.
function xpFrom(player: Player, weeks: number[], fromWeek: number): number {
  return weeks.filter((week) => week >= fromWeek).reduce((sum, week) => sum + (player.xp[String(week)] ?? 0), 0);
}

// His next few matches from `fromWeek`, with the ticker's difficulty.
function fixturesFrom(snapshot: Snapshot, player: Player, fromWeek: number) {
  const team = snapshot.fixtureTicker.teams.find((candidate) => candidate.id === player.teamId);
  const forDefence = player.position === "GK" || player.position === "DEF";
  const chips: { label: string; difficulty: number }[] = [];
  for (const week of snapshot.fixtureTicker.weeks.filter((tickerWeek) => tickerWeek >= fromWeek)) {
    for (const match of team?.matches[String(week)] ?? []) {
      chips.push({ label: `${match.opponent} ${match.isHome ? "H" : "A"}`, difficulty: forDefence ? match.defenceDifficulty : match.attackDifficulty });
    }
  }
  return chips.slice(0, FIXTURES_SHOWN);
}

// Short warnings about a player: injury chance, news, yellow cards, set pieces.
function playerNotes(snapshot: Snapshot, player: Player): string[] {
  const notes: string[] = [];
  if (player.chance !== null && player.chance < 100) notes.push(`${player.chance}% to play`);
  if (player.news) notes.push(player.news);
  const flag = snapshot.flags.find((item) => item.playerId === player.id && item.kind === "suspension");
  if (flag) notes.push("1 yellow from a ban");
  if (player.setPieces?.penalties === 1) notes.push("takes penalties");
  return notes;
}

// One side of a transfer: name, club, price, xP over the rest of the plan and fixtures.
function PlayerCell({ snapshot, id, fromWeek, price }: { snapshot: Snapshot; id: number; fromWeek: number; price: number }) {
  const player = snapshot.players[String(id)];
  if (!player) return <div className="plan-player">#{id}</div>;
  const notes = playerNotes(snapshot, player);
  return (
    <div className="plan-player">
      <div className="plan-player-top">
        <PlayerLink id={id} name={player.name} />
        <span className="muted">{player.team} · {player.position} · {formatPrice(price)}</span>
      </div>
      <div className="plan-player-bottom">
        <b className="num">{formatXp(xpFrom(player, snapshot.weeks, fromWeek))} xP</b>
        <span className="muted"> to GW{snapshot.weeks[snapshot.weeks.length - 1]}</span>
        <span className="bc-fixtures">
          {fixturesFrom(snapshot, player, fromWeek).map((fixture, index) => (
            <span key={index} className={`bc-fixture level-${fixture.difficulty}`}>{fixture.label}</span>
          ))}
        </span>
      </div>
      {notes.length > 0 && <div className="plan-notes bc-warn">{notes.join(" · ")}</div>}
    </div>
  );
}

// One gameweek: its moves side by side, or the Free Hit squad, plus the before and after squad for chip weeks.
function WeekDetail({ week, before, snapshot }: { week: SolverWeek; before: number[]; snapshot: Snapshot }) {
  const totalValue = week.moves.reduce((sum, move) => sum + move.value, 0);
  return (
    <section className="card plan-week">
      <div className="card-head">
        <h2>GW{week.gameweek}{week.chip && <span className="chip good plan-chip-tag">{CHIP_LABELS[week.chip]}</span>}</h2>
        <span className="muted">
          Lineup {formatXp(week.xp)} xP · captain {nameOf(snapshot, week.captain)} · bank after {formatPrice(week.bank)}
          {week.hits > 0 && <b className="bc-warn"> · -{week.hits * 4} hit</b>}
        </span>
      </div>
      {week.chip === "freehit" && week.freeHitSquad ? (
        <FreeHitSquad week={week} snapshot={snapshot} />
      ) : week.moves.length === 0 ? (
        <p className="muted plan-text">No transfers: the free transfer rolls over to next week.</p>
      ) : (
        <>
          <div className="plan-moves">
            {week.moves.map((move) => (
              <div key={`${move.out}-${move.in}`} className="plan-move">
                <PlayerCell snapshot={snapshot} id={move.out} fromWeek={week.gameweek} price={snapshot.players[String(move.out)]?.sellingPrice ?? 0} />
                <span className="plan-arrow" aria-label="replaced by">→</span>
                <PlayerCell snapshot={snapshot} id={move.in} fromWeek={week.gameweek} price={snapshot.players[String(move.in)]?.price ?? 0} />
                <span className="plan-move-value">
                  <b className={`num ${move.value >= 0 ? "bc-accent" : "bc-warn"}`}>{formatGain(move.value)}</b>
                  <span className="muted">xP from this move</span>
                  {move.priceNote && <span className="bc-accent plan-price-note">{move.priceNote}</span>}
                  {move.sameWeekShare !== undefined && <SureBadge move={move} />}
                </span>
              </div>
            ))}
          </div>
          <p className="muted plan-text">
            Each move&apos;s number is the five-week xP you&apos;d lose by undoing just that move. Together they come to {formatGain(totalValue)}.
            {week.chip === "wildcard" && " With the Wildcard, all these moves are free this week."}
          </p>
          {week.chip === "wildcard" && <SquadChange before={before} after={week.squad} snapshot={snapshot} />}
        </>
      )}
    </section>
  );
}

// "In 13 of 15 runs": how often the noisy re-solves made this move, in this week (and in any week).
function SureBadge({ move }: { move: SolverWeek["moves"][number] }) {
  const same = Math.round((move.sameWeekShare ?? 0) * 100);
  const any = Math.round((move.anyWeekShare ?? 0) * 100);
  const tone = same >= 70 ? "bc-accent" : same >= 40 ? "" : "bc-warn";
  return (
    <span className={`plan-sure ${tone}`} title="How often the plan made this move when every player's xP was nudged at random">
      {same}% of runs{any > same ? ` (${any}% in some week)` : ""}
    </span>
  );
}

// The Free Hit squad for its one week, with each player's xP that week.
function FreeHitSquad({ week, snapshot }: { week: SolverWeek; snapshot: Snapshot }) {
  const ids = [...week.freeHitSquad!].sort((a, b) => positionOrder(snapshot, a) - positionOrder(snapshot, b));
  return (
    <>
      <p className="plan-text">
        For GW{week.gameweek} only, this squad plays instead of yours. Your own squad isn&apos;t changed and comes back for GW{week.gameweek + 1}.
        Players you already own are marked.
      </p>
      <div className="plan-squad-grid">
        {ids.map((id) => {
          const player = snapshot.players[String(id)];
          return (
            <div key={id} className={snapshot.squad.includes(id) ? "plan-squad-player owned" : "plan-squad-player"}>
              <span className="muted">{player?.position}</span>
              <PlayerLink id={id} name={player?.name ?? `#${id}`} />
              <span className="muted">{player?.team}</span>
              <b className="num">{formatXp(player?.xp[String(week.gameweek)] ?? 0)}</b>
            </div>
          );
        })}
      </div>
    </>
  );
}

// Position order for sorting squads: keepers, defenders, midfielders, forwards.
function positionOrder(snapshot: Snapshot, id: number): number {
  return ["GK", "DEF", "MID", "FWD"].indexOf(snapshot.players[String(id)]?.position ?? "FWD");
}

// Before and after a Wildcard, position by position, so the whole rebuild is visible at once.
function SquadChange({ before, after, snapshot }: { before: number[]; after: number[]; snapshot: Snapshot }) {
  const sorted = (ids: number[]) => [...ids].sort((a, b) => positionOrder(snapshot, a) - positionOrder(snapshot, b));
  const column = (title: string, ids: number[], other: number[]) => (
    <div className="plan-squad-column">
      <h3>{title}</h3>
      {sorted(ids).map((id) => (
        <div key={id} className={other.includes(id) ? "plan-squad-player" : "plan-squad-player changed"}>
          <span className="muted">{snapshot.players[String(id)]?.position}</span>
          <PlayerLink id={id} name={nameOf(snapshot, id)} />
          <span className="muted">{snapshot.players[String(id)]?.team}</span>
          <b className="num">{formatPrice(snapshot.players[String(id)]?.price ?? 0)}</b>
        </div>
      ))}
    </div>
  );
  return (
    <div className="plan-squad-change">
      {column("Squad before", before, after)}
      {column("Squad after", after, before)}
    </div>
  );
}

// The best plan with no chips at all, so there's a concrete option to compare against.
function Alternative({ plan, snapshot }: { plan: SolverPlan; snapshot: Snapshot }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>The alternative: normal transfers only</h2>
        <span className="muted">{formatGain(plan.normalTransfers.gain)} xP vs no moves · {formatGain(plan.gain - plan.normalTransfers.gain)} xP less than the plan</span>
      </div>
      <ul className="plan-weeks">
        {plan.normalTransfers.weeks.map((week) => (
          <li key={week.gameweek}>
            GW{week.gameweek}:{" "}
            {week.moves.length === 0
              ? "roll the transfer"
              : week.moves.map((move) => `${nameOf(snapshot, move.out)} → ${nameOf(snapshot, move.in)} (${formatGain(move.value)})`).join(", ")}
            {week.hits > 0 && ` · -${week.hits * 4} hit`}
          </li>
        ))}
      </ul>
    </section>
  );
}

// What could make the plan wrong, in plain words, plus the moves the noisy re-solves liked instead.
function HowSure({ plan, snapshot }: { plan: SolverPlan; snapshot: Snapshot }) {
  const sensitivity = plan.sensitivity;
  const closeCalls = snapshot.chipPlan.cards.filter((card) => card.decision?.closeCall).map((card) => card.label);
  const notes = [
    "Expected points are averages: a single gameweek can swing a long way either side.",
    "The xP model is backtested on three past seasons; this transfer plan and its chip rules haven't been backtested yet.",
    "Later weeks lean more on fixtures than on form, so they count less and are rougher.",
    ...(closeCalls.length > 0 ? [`Close calls, where playing and saving are within ${plan.closeCallPoints} points: ${closeCalls.join(", ")}.`] : []),
    ...(!plan.finishedSearch ? ["The solver hit its time limit, so a slightly better plan may exist."] : []),
  ];
  return (
    <section className="card">
      <div className="card-head"><h2>How sure is this?</h2></div>
      {sensitivity && (
        <p className="plan-text">
          To test how solid the transfers are, the plan was worked out again {sensitivity.runs} times with every player&apos;s xP nudged at
          random (more for players whose minutes are uncertain), keeping the chips where they are. Each move shows how often it came back.
          {sensitivity.firstWeekAlternatives.length > 0 && (
            <> In GW{plan.weeks[0].gameweek}, other runs sometimes chose:{" "}
              {sensitivity.firstWeekAlternatives.map((alt) => `${nameOf(snapshot, alt.out)} → ${nameOf(snapshot, alt.in)} (${Math.round(alt.share * 100)}%)`).join(", ")}.
            </>
          )}
        </p>
      )}
      <ul className="plan-weeks">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>
  );
}
