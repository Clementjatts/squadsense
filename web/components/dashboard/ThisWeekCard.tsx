// "This week": the three decisions for the coming deadline: transfers,
// captain and chip. Transfers and the chip come from the one plan
// (jobs/squadsense/strategy.py), the same one the Planner and Chip
// Planner show, so the pages always agree.

import { MadeMoveButton } from "@/components/MadeMoveButton";
import { formatGain, formatXp } from "@/lib/format";
import { nextFixtures } from "@/lib/dashboard";
import { alreadyMadeLine } from "@/lib/madeMoves";
import Link from "next/link";
import type { ChipCard, Snapshot, SolverWeek } from "@/lib/types";

type Marks = { marked: Set<number>; error: string | null };

export function ThisWeekCard({ snapshot, marks }: { snapshot: Snapshot; marks: Marks }) {
  const chip = snapshot.chipPlan.cards.find((card) => card.decision?.action === "play" && card.decision.playNow);
  return (
    <section className="bc-card bc-thisweek">
      <div className="bc-thisweek-head">
        <span className="bc-title">THIS WEEK</span>
        <span className="bc-eyebrow">3 DECISIONS</span>
      </div>
      <TransferBlock snapshot={snapshot} marks={marks} />
      <CaptainBlock snapshot={snapshot} />
      <ChipBlock snapshot={snapshot} chip={chip} />
    </section>
  );
}

// One line naming this week's moves from the plan: "Raya → Trafford" or "3 transfers: Raya, Gabriel...".
function planHeadline(week: SolverWeek, snapshot: Snapshot): string {
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `#${id}`;
  if (week.chip === "freehit") return "Free Hit squad";
  if (week.moves.length === 0) return snapshot.madeMoves?.length ? "No more transfers" : "Roll the transfer";
  if (week.moves.length === 1) return `${name(week.moves[0].out)} → ${name(week.moves[0].in)}`;
  return `${week.moves.length} transfers`;
}

// This week's transfers from the plan, or the best single move when there's no plan.
// A single planned move gets its "Done on FPL" button here; several are marked on the Plan page.
function TransferBlock({ snapshot, marks }: { snapshot: Snapshot; marks: Marks }) {
  const week = snapshot.solverPlan?.weeks[0];
  if (week) {
    const value = week.moves.reduce((sum, move) => sum + move.value, 0);
    const made = alreadyMadeLine(snapshot.madeMoves, (id) => snapshot.players[String(id)]?.name ?? `#${id}`);
    const only = week.chip !== "freehit" && week.moves.length === 1 ? week.moves[0] : null;
    return (
      <div className="bc-decision">
        <span className="bc-eyebrow bc-accent">TRANSFERS</span>
        <div className="bc-decision-main">
          <div className="bc-decision-text">
            <span className="bc-decision-name bc-decision-name-small">{planHeadline(week, snapshot)}</span>
            <span className="bc-note bc-one-line">
              From your five-week plan · <Link href="/plan" className="bc-accent">see why</Link>
            </span>
          </div>
          {week.moves.length > 0 && <span className="bc-decision-number bc-decision-number-small">{formatGain(value)}</span>}
        </div>
        {made && <span className="bc-note made-move-line">{made}</span>}
        {only && <MadeMoveButton gameweek={week.gameweek} out={only.out} into={only.in} marked={marks.marked.has(only.out)} />}
        {marks.error && <span className="bc-warn">{marks.error}</span>}
      </div>
    );
  }
  const move = snapshot.suggestions[0];
  return (
    <div className="bc-decision">
      <span className="bc-eyebrow bc-accent">TRANSFER</span>
      {move ? (
        <div className="bc-decision-main">
          <div className="bc-decision-text">
            <span className="bc-decision-name bc-decision-name-small">
              {snapshot.players[String(move.out)].name} → {snapshot.players[String(move.in)].name}
            </span>
            <span className="bc-note bc-one-line">
              {move.priceNote ?? `Over ${snapshot.weeks.length} gameweeks`} · {move.advice === "make" ? "worth making now" : "worth less than rolling the transfer"}
            </span>
          </div>
          <span className="bc-decision-number bc-decision-number-small">{formatGain(move.gain)}</span>
        </div>
      ) : (
        <div className="bc-decision-text">
          <span className="bc-decision-name bc-decision-name-small">No move needed</span>
          <span className="bc-note bc-one-line">
            {snapshot.squadSource === "model" ? "This squad is already the model's best pick" : "No single transfer beats your squad"}
          </span>
        </div>
      )}
    </div>
  );
}

const ALTERNATIVE_ROLES = ["VICE CAPTAIN", "ALSO STRONG"];

// The model's captain, his fixture, and the next two options as bars.
function CaptainBlock({ snapshot }: { snapshot: Snapshot }) {
  const [top, ...others] = snapshot.captainOptions;
  if (!top) return null;
  const captain = snapshot.players[String(top.playerId)];
  const fixture = nextFixtures(snapshot, captain, 1)[0];
  return (
    <div className="bc-decision">
      <span className="bc-eyebrow bc-accent">CAPTAIN</span>
      <div className="bc-decision-main">
        <div className="bc-decision-text">
          <span className="bc-decision-name">{captain.name}</span>
          <span className="bc-note bc-one-line">
            {captain.team}
            {fixture ? ` v ${fixture.label.replace(/ ([HA])$/, " ($1)")}` : ""} · {top.safety.toLowerCase()} · {Math.round(top.haulChance * 100)}% for 10+
          </span>
        </div>
        <span className="bc-decision-number">{formatXp(top.xp)}</span>
      </div>
      <div className="bc-alternatives">
        {others.slice(0, 2).map((option, index) => (
          <div key={option.playerId} className="bc-alt">
            <span className="bc-alt-role">{ALTERNATIVE_ROLES[index]}</span>
            <span className="bc-alt-name">{snapshot.players[String(option.playerId)].name}</span>
            <span className="bc-alt-track">
              <span className="bc-alt-fill" style={{ width: `${Math.round((option.xp / top.xp) * 100)}%` }} />
            </span>
            <b className="bc-alt-xp">{formatXp(option.xp)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// The chip worth playing this week, or a note to save them.
function ChipBlock({ snapshot, chip }: { snapshot: Snapshot; chip: ChipCard | undefined }) {
  return (
    <div className="bc-decision">
      <span className="bc-eyebrow bc-accent">CHIP TO PLAY</span>
      {chip ? (
        <div className="bc-decision-main">
          <div className="bc-decision-text">
            <span className="bc-decision-name bc-decision-name-small">{chip.label}</span>
            <span className="bc-note bc-one-line">{chipReason(snapshot, chip)}</span>
          </div>
          <span className="bc-decision-number bc-decision-number-small">{formatGain(chip.decision?.gain ?? 0)}</span>
        </div>
      ) : (
        <div className="bc-decision-text">
          <span className="bc-decision-name bc-decision-name-small">None this week</span>
          <span className="bc-note bc-one-line">Your chips are worth more in later gameweeks</span>
        </div>
      )}
    </div>
  );
}

// One short line on why. For Bench Boost, how many subs have a match.
function chipReason(snapshot: Snapshot, chip: ChipCard): string {
  if (chip.chip !== "bboost") return chip.reason;
  const bench = snapshot.lineups[String(snapshot.gameweek)].bench;
  const playing = bench.filter((id) => {
    const team = snapshot.fixtureTicker.teams.find((candidate) => candidate.id === snapshot.players[String(id)].teamId);
    return (team?.matches[String(snapshot.gameweek)] ?? []).length > 0;
  }).length;
  return playing === bench.length ? `All ${bench.length} subs have a match this week` : `${playing} of your ${bench.length} subs have a match this week`;
}
