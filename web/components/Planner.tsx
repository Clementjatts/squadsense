"use client";

// The interactive Transfer Planner. Click a player on the pitch or bench,
// pick a replacement from the table, and every number updates straight away.
// Nothing here talks to FPL: it's a sandbox for testing ideas.

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { ApplyToFpl } from "./ApplyToFpl";
import { BroadcastPitch } from "./BroadcastPitch";
import { PageHero } from "./PageHero";
import { formatFreeTransfers, formatGain, formatPrice, formatXp } from "@/lib/format";
import { MAX_PER_CLUB, planScore, replacementOptions, simulatePlan, type FreeHitSquads, type PlannedChips, type PlannedMove, type PlannerChip } from "@/lib/planning";
import type { Player, SolverPlan, Snapshot } from "@/lib/types";

const PLANNER_CHIP_LABELS: Record<PlannerChip, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

// The one-week squads the five-week plan built, by gameweek (only for its Free Hit week).
function freeHitSquadsFrom(snapshot: Snapshot): FreeHitSquads {
  const squads: FreeHitSquads = {};
  for (const week of snapshot.solverPlan?.weeks ?? []) if (week.freeHitSquad) squads[week.gameweek] = week.freeHitSquad;
  return squads;
}

// Chips you can still try in the sandbox: available this half, in weeks up to the half's last one.
// Free Hit needs a one-week squad, so it's only offered in the week the plan built one for.
function plannerChipsFor(snapshot: Snapshot, week: number, freeHitSquads: FreeHitSquads): PlannerChip[] {
  if (week > snapshot.chipPlan.halfStop) return [];
  return snapshot.chipPlan.cards
    .filter((card) => card.status === "available")
    .map((card) => card.chip)
    .filter((chip) => chip !== "freehit" || freeHitSquads[week] !== undefined)
    .filter((chip) => !((chip === "wildcard" || chip === "freehit") && snapshot.freeTransfers === null && week === snapshot.weeks[0]));
}

// For applying a Free Hit to FPL: swap your squad for the one-week squad, pairing players by position.
function freeHitMoves(squad: number[], freeHitSquad: number[], players: Record<string, Player>): { outId: number; inId: number }[] {
  const incoming = freeHitSquad.filter((id) => !squad.includes(id));
  return squad
    .filter((id) => !freeHitSquad.includes(id))
    .map((outId) => {
      const index = incoming.findIndex((inId) => players[String(inId)]?.position === players[String(outId)]?.position);
      const [inId] = incoming.splice(index, 1);
      return { outId, inId };
    });
}

const OPTIONS_SHOWN = 12;

export function Planner({ snapshot }: { snapshot: Snapshot }) {
  const { players, weeks } = snapshot;
  const [moves, setMoves] = useState<PlannedMove[]>([]);
  const [chips, setChips] = useState<PlannedChips>({});
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]);
  const [swapOutId, setSwapOutId] = useState<number | null>(null);

  // Recalculate the whole plan whenever a move is added or removed.
  const freeHitSquads = useMemo(() => freeHitSquadsFrom(snapshot), [snapshot]);
  const plans = useMemo(() => simulatePlan(snapshot, moves, chips, freeHitSquads), [snapshot, moves, chips, freeHitSquads]);
  const baselineScore = useMemo(() => planScore(simulatePlan(snapshot, [])), [snapshot]);
  const totalScore = planScore(plans);
  const weekPlan = plans.find((plan) => plan.week === selectedWeek) ?? plans[0];
  const weekMoves = moves.filter((move) => move.week === selectedWeek);

  // Money available for a replacement before this week's moves are counted.
  const previousPlan = plans[plans.indexOf(weekPlan) - 1];
  const bankBeforeWeek = previousPlan ? previousPlan.bankAfter : snapshot.bank;

  function chooseWeek(week: number) {
    setSelectedWeek(week);
    setSwapOutId(null);
  }

  function addMove(inId: number) {
    if (swapOutId === null) return;
    setMoves([...moves, { week: selectedWeek, outId: swapOutId, inId }]);
    setSwapOutId(null);
  }

  // Removing a move also removes any later move that sold the player it
  // brought in, otherwise the later move would sell someone you don't own.
  function removeMove(target: PlannedMove) {
    setMoves(
      moves.filter(
        (move) => move !== target && !(move.week > target.week && move.outId === target.inId),
      ),
    );
  }

  const outPlayer = swapOutId !== null ? players[swapOutId] : null;
  const options = swapOutId !== null ? replacementOptions(snapshot, weekPlan.squad, swapOutId).slice(0, OPTIONS_SHOWN) : [];
  const incomingIds = weekMoves.map((move) => move.inId);

  const totalHits = plans.reduce((sum, plan) => sum + plan.hitPoints, 0);

  return (
    <>
      {/* The plan's headline numbers. They update as you add or undo moves. */}
      <PageHero
        eyebrow={`GW${weeks[0]} TO GW${weeks[weeks.length - 1]}`}
        title="TRANSFER PLANNER"
        subtitle={
          snapshot.squadSource === "model"
            ? "Model-picked squad until your picks go public. Nothing changes on FPL until you make it there."
            : "Test moves before you make them. Nothing changes on FPL until you make it there."
        }
        figures={[
          { label: "Plan vs no moves", value: <AnimatedNumber value={totalScore - baselineScore} format={(value) => `${formatGain(value)} xP`} />, accent: true },
          { label: "Transfers planned", value: moves.length },
          { label: "Points hit", value: totalHits === 0 ? "0" : `-${totalHits}` },
        ]}
      />

      <section className="weeks" aria-label="Plan by gameweek">
        {plans.map((plan) => (
          <button key={plan.week} type="button" className="week-card" aria-pressed={plan.week === selectedWeek} onClick={() => chooseWeek(plan.week)}>
            <span className="week-card-top">
              <span className="week-card-gw">GW{plan.week}</span>
              {plan.chip ? (
                <span className="chip good">{PLANNER_CHIP_LABELS[plan.chip]}</span>
              ) : (
                snapshot.doubles[String(plan.week)]?.length > 0 && <span className="chip good">Double</span>
              )}
            </span>
            <span className="week-card-xp">
              <AnimatedNumber value={plan.expectedPoints} format={formatXp} />
              <span className="week-card-unit">xP</span>
            </span>
            <span className="week-card-meta">
              {plan.transfersMade === 0 ? "No transfers" : `${plan.transfersMade} transfer${plan.transfersMade > 1 ? "s" : ""}`} · Free{" "}
              {formatFreeTransfers(plan.freeTransfersBefore)}
              {plan.hitPoints > 0 && <b className="bc-warn"> · -{plan.hitPoints}</b>}
            </span>
          </button>
        ))}
      </section>

      <div className="row">
        <div className="col-wide" style={{ flex: "1.25 1 660px" }}>
          <BroadcastPitch
            title={`GW${selectedWeek} SQUAD`}
            hint="Click a player to replace him"
            starters={weekPlan.starters}
            bench={weekPlan.bench}
            captain={weekPlan.captain}
            viceCaptain={weekPlan.viceCaptain}
            players={players}
            week={selectedWeek}
            selectedId={swapOutId}
            incomingIds={incomingIds}
            onPlayerClick={setSwapOutId}
          />

        </div>

        <div className="col-narrow" style={{ flex: "1 1 460px" }}>
          <section className="card">
            <div className="card-head">
              <h2>GW{selectedWeek} check</h2>
            </div>
            <div className="summary-grid">
              <div>
                <span className="muted">Bank after</span>
                <b>
                  {/* Prices are whole tenths, so round the in-between values before formatting. */}
                  <AnimatedNumber value={weekPlan.bankAfter} format={(value) => formatPrice(Math.round(value))} />
                </b>
              </div>
              <div>
                <span className="muted">Free transfers used</span>
                <b className="num">
                  {/* "∞" when transfers are unlimited, as in a team's first week. */}
                  {weekPlan.freeTransfersBefore === null
                    ? `${weekPlan.transfersMade} / ∞`
                    : `${Math.min(weekPlan.transfersMade, weekPlan.freeTransfersBefore)} / ${weekPlan.freeTransfersBefore}`}
                </b>
              </div>
              <div>
                <span className="muted">Points hit</span>
                <b className="num">{weekPlan.hitPoints}</b>
              </div>
            </div>
            <ChipPicker
              options={plannerChipsFor(snapshot, selectedWeek, freeHitSquads)}
              chips={chips}
              week={selectedWeek}
              onChange={setChips}
            />
            {selectedWeek === weeks[0] && snapshot.squadSource === "fpl" && weekPlan.problems.length === 0 && (
              <ApplyToFpl
                plan={{
                  gameweek: selectedWeek,
                  moves: weekPlan.freeHitSquad
                    ? freeHitMoves(weekPlan.squad, weekPlan.freeHitSquad, players)
                    : weekMoves.map((move) => ({ outId: move.outId, inId: move.inId })),
                  starters: weekPlan.starters,
                  bench: weekPlan.bench,
                  captain: weekPlan.captain,
                  viceCaptain: weekPlan.viceCaptain,
                  chip: weekPlan.chip,
                }}
              />
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {weekPlan.problems.length === 0 ? (
                <span className="chip good">Budget and club limits OK</span>
              ) : (
                weekPlan.problems.map((problem) => (
                  <span key={problem} className="chip bad">
                    {problem}
                  </span>
                ))
              )}
            </div>
            {/* Moves slide in when added and out when undone. The list stays
                mounted so the last one can animate out; it hides when empty. */}
            <div className="moves">
              <AnimatePresence initial={false}>
                {weekMoves.map((move) => (
                  <motion.div
                    className="move"
                    key={`${move.outId}-${move.inId}`}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <span className="grow">
                      {players[move.outId].name} → {players[move.inId].name}
                    </span>
                    <button type="button" className="btn" onClick={() => removeMove(move)}>
                      Undo
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
          <section className="card">
            {/* Crossfade between "Suggested moves" and "Replace ...": the old
                view fades out before the new one fades in. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={outPlayer ? `replace-${outPlayer.id}` : "suggested"}
                className="card-body"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                {outPlayer ? (
                  <>
                    <div className="card-head">
                      <h2>Replace {outPlayer.name}</h2>
                      <button type="button" className="btn" onClick={() => setSwapOutId(null)}>
                        Cancel
                      </button>
                    </div>
                    <p className="muted" style={{ margin: 0 }}>
                      You can spend up to {formatPrice(bankBeforeWeek + outPlayer.sellingPrice)} on a {outPlayer.position}.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Player</th>
                            <th scope="col">Club</th>
                            <th scope="col" className="right">Price</th>
                            <th scope="col" className="right">Owned</th>
                            <th scope="col" className="right">xP next {weeks.length}</th>
                            <th scope="col" className="right">vs {outPlayer.name}</th>
                            <th scope="col"><span className="muted">Add</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {options.map((option) => {
                            const affordable = option.price <= bankBeforeWeek + outPlayer.sellingPrice;
                            const clubCount = weekPlan.squad.filter((id) => id !== outPlayer.id && players[id].team === option.team).length;
                            const clubFull = clubCount >= MAX_PER_CLUB;
                            const blockedReason = !affordable ? "Too expensive" : clubFull ? `Already ${MAX_PER_CLUB} from ${option.team}` : null;
                            return (
                              <tr key={option.id} style={{ opacity: blockedReason ? 0.5 : 1 }}>
                                <td><strong>{option.name}</strong></td>
                                <td className="muted">{option.team}</td>
                                <td className="right">{formatPrice(option.price)}</td>
                                <td className="right muted">{option.ownership.toFixed(1)}%</td>
                                <td className="right"><b>{formatXp(option.windowXp)}</b></td>
                                <td className="right gain">{formatGain(option.windowXp - outPlayer.windowXp)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={blockedReason !== null}
                                    title={blockedReason ?? undefined}
                                    onClick={() => addMove(option.id)}
                                    aria-label={`Bring in ${option.name}`}
                                  >
                                    Add
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="card-head">
                      <h2>Single moves to try</h2>
                      <span className="muted">One transfer at a time, no chips. Your recommended plan is below.</span>
                    </div>
                    {snapshot.suggestions.length === 0 && (
                      <p className="muted">
                        {snapshot.squadSource === "model"
                          ? "No suggestions: this squad is already the model's best pick for the week."
                          : "No single transfer beats your current squad over the next few weeks."}
                      </p>
                    )}
                    <ul className="list">
                      {snapshot.suggestions.map((suggestion) => (
                        <li key={`${suggestion.out}-${suggestion.in}`}>
                          <span className="grow">
                            <strong>
                              {players[suggestion.out].name} → {players[suggestion.in].name}
                            </strong>
                            <span className="muted">
                              {formatGain(suggestion.gain)} xP · {suggestion.advice === "make" ? "make it" : "roll instead"}
                              {suggestion.priceNote && <> · <span className="bc-accent">{suggestion.priceNote}</span></>}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="btn"
                            disabled={!plans[0].squad.includes(suggestion.out) || plans[0].squad.includes(suggestion.in)}
                            onClick={() => {
                              chooseWeek(weeks[0]);
                              setMoves([...moves, { week: weeks[0], outId: suggestion.out, inId: suggestion.in }]);
                            }}
                          >
                            Try it
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="muted" style={{ margin: 0 }}>
                      Or click any player on the pitch to search for a replacement yourself.
                    </p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </section>
          {snapshot.solverPlan && (
            <SolverPlanCard
              plan={snapshot.solverPlan}
              snapshot={snapshot}
              onApply={() => {
                setMoves(solverMoves(snapshot.solverPlan!));
                setChips(solverChips(snapshot.solverPlan!));
                setSwapOutId(null);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// The solver's moves in the Planner's own format, so they can be loaded in one click.
function solverMoves(plan: SolverPlan): PlannedMove[] {
  return plan.weeks.flatMap((week) => week.moves.map((move) => ({ week: week.gameweek, outId: move.out, inId: move.in })));
}

// The plan's chips in the sandbox's format: gameweek -> chip (Free Hit is never in the plan).
function solverChips(plan: SolverPlan): PlannedChips {
  const chips: PlannedChips = {};
  for (const week of plan.weeks) if (week.chip) chips[week.gameweek] = week.chip;
  return chips;
}

interface ChipPickerProps {
  options: PlannerChip[];
  chips: PlannedChips;
  week: number;
  onChange: (next: PlannedChips) => void;
}

// Pick a chip for the selected week. Choosing one moves it off any other week, since each chip plays once.
function ChipPicker({ options, chips, week, onChange }: ChipPickerProps) {
  if (options.length === 0) return null;
  function choose(value: string) {
    const next: PlannedChips = {};
    for (const [otherWeek, chip] of Object.entries(chips)) {
      if (Number(otherWeek) !== week && chip !== value) next[Number(otherWeek)] = chip;
    }
    if (value) next[week] = value as PlannerChip;
    onChange(next);
  }
  return (
    <label className="chip-picker">
      <span className="muted">Chip this week</span>
      <select className="bc-select" value={chips[week] ?? ""} onChange={(event) => choose(event.target.value)}>
        <option value="">None</option>
        {options.map((chip) => <option key={chip} value={chip}>{PLANNER_CHIP_LABELS[chip]}</option>)}
      </select>
    </label>
  );
}

// A short summary of the five-week plan, with a link to the full explanation.
// Big decisions (a Wildcard, a Free Hit, a hit) are explained on /plan, not here.
function SolverPlanCard({ plan, snapshot, onApply }: { plan: SolverPlan; snapshot: Snapshot; onApply: () => void }) {
  const { players } = snapshot;
  return (
    <section className="card solver-card">
      <div className="card-head">
        <h2>Your {plan.weeks.length}-week plan</h2>
        <span className="muted">{formatGain(plan.gain - plan.normalTransfers.gain)} xP better than normal transfers alone</span>
      </div>
      <ol className="solver-weeks">
        {plan.weeks.map((week) => (
          <li key={week.gameweek} className="solver-week">
            <span className="solver-gw">GW{week.gameweek}</span>
            <span className="solver-moves">
              {week.chip && <span className="bc-set-tag solver-chip">{PLANNER_CHIP_LABELS[week.chip]}</span>}
              {week.chip === "freehit"
                ? "One-week squad"
                : week.moves.length === 0
                  ? <span className="muted">Roll the transfer</span>
                  : week.moves.length > 2
                    ? `${week.moves.length} transfers`
                    : week.moves.map((move) => `${players[String(move.out)].name} → ${players[String(move.in)].name}`).join(", ")}
            </span>
            <span className="solver-meta muted">
              {week.hits > 0 ? <b className="bc-warn">-{week.hits * 4}</b> : `C ${players[String(week.captain)]?.name ?? ""}`}
            </span>
          </li>
        ))}
      </ol>
      <a href="/plan" className="btn">See the full plan and why</a>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" className="btn primary" onClick={onApply}>Load into planner</button>
        <span className="muted">
          Replaces the moves and chips you&apos;ve planned so far.
          {!plan.finishedSearch && " The solver hit its time limit, so a slightly better plan may exist."}
        </span>
      </div>
    </section>
  );
}
