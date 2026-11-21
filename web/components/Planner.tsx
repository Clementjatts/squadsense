"use client";

// The interactive Transfer Planner. Click a player on the pitch or bench,
// pick a replacement from the table, and every number updates straight away.
// Nothing here talks to FPL: it's a sandbox for testing ideas.

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { BroadcastPitch } from "./BroadcastPitch";
import { PageHero } from "./PageHero";
import { formatFreeTransfers, formatGain, formatPrice, formatXp } from "@/lib/format";
import { MAX_PER_CLUB, planScore, replacementOptions, simulatePlan, type PlannedMove } from "@/lib/planning";
import type { Snapshot } from "@/lib/types";

const OPTIONS_SHOWN = 12;

export function Planner({ snapshot }: { snapshot: Snapshot }) {
  const { players, weeks } = snapshot;
  const [moves, setMoves] = useState<PlannedMove[]>([]);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]);
  const [swapOutId, setSwapOutId] = useState<number | null>(null);

  // Recalculate the whole plan whenever a move is added or removed.
  const plans = useMemo(() => simulatePlan(snapshot, moves), [snapshot, moves]);
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
              {snapshot.doubles[String(plan.week)]?.length > 0 && <span className="chip good">Double</span>}
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
                      <h2>Suggested moves</h2>
                      <span className="muted">From the model, GW{weeks[0]}</span>
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
        </div>
      </div>
    </>
  );
}
