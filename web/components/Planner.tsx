"use client";

// The interactive Transfer Planner. Click a player on the pitch or bench,
// pick a replacement from the table, and every number updates straight away.
// Nothing here talks to FPL: it's a sandbox for testing ideas. Phones hide
// the pitch and use the "Pick who to sell" list (SellList) instead.

import { MadeMoveButton } from "./MadeMoveButton";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { ApplyToFpl } from "./ApplyToFpl";
import { BroadcastPitch } from "./BroadcastPitch";
import { PageHero } from "./PageHero";
import { LineupEditor } from "./LineupEditor";
import { ScenariosCard, usePlannerDrafts } from "./PlannerDrafts";
import { SegmentedControl } from "./SegmentedControl";
import { SellList } from "./SellList";
import { formatFreeTransfers, formatGain, formatPrice, formatXp } from "@/lib/format";
import {
  MAX_PER_CLUB, planScore, plannerRequest, replacementOptions, setArmband, simulatePlan, swapInLineup,
  type FreeHitSquads, type LineupChoice, type PlannedCaptains, type PlannedChips, type PlannedLineups, type PlannedMove, type PlannerChip, type WeekPlan,
} from "@/lib/planning";
import type { PlannerDraft } from "@/lib/drafts";
import type { Player, SolverPlan, Snapshot, Suggestion } from "@/lib/types";

// The same width the phone CSS uses, so the scrolling below only happens on phones.
const PHONE_QUERY = "(max-width: 560px)";

// Scrolls a card to the top of the screen on phones, where it may be far
// from what was just tapped. On wider screens everything is already in view.
function scrollIntoViewOnPhone(element: HTMLElement | null) {
  if (element && window.matchMedia(PHONE_QUERY).matches) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

const PLANNER_CHIP_LABELS: Record<PlannerChip, string> = { bboost: "Bench Boost", "3xc": "Triple Captain", freehit: "Free Hit", wildcard: "Wildcard" };

// The best one-week squad for every week Free Hit could be played, by gameweek.
// Plans saved before these were stored only have the one in the plan's own Free Hit week.
function freeHitSquadsFrom(snapshot: Snapshot): FreeHitSquads {
  const squads: FreeHitSquads = {};
  for (const [week, squad] of Object.entries(snapshot.solverPlan?.freeHitSquads ?? {})) squads[Number(week)] = squad;
  for (const week of snapshot.solverPlan?.weeks ?? []) if (week.freeHitSquad) squads[week.gameweek] = week.freeHitSquad;
  return squads;
}

// Chips you can still try in the sandbox: available this half, in weeks up to the half's last one.
// Free Hit needs a one-week squad, so it's only offered in weeks the plan built one for.
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

// `markedOuts`: players already marked "Done on FPL" as sold in the coming week (their moves show as made).
export function Planner({ snapshot, markedOuts }: { snapshot: Snapshot; markedOuts: number[] }) {
  const { players, weeks } = snapshot;
  const [moves, setMoves] = useState<PlannedMove[]>([]);
  const [chips, setChips] = useState<PlannedChips>({});
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]);
  const [swapOutId, setSwapOutId] = useState<number | null>(null);
  const [bringInId, setBringInId] = useState<number | null>(null); // a player to buy, waiting for you to pick who he replaces
  const [captains, setCaptains] = useState<PlannedCaptains>({});
  const [lineups, setLineups] = useState<PlannedLineups>({});
  const [pitchMode, setPitchMode] = useState<"transfers" | "lineup">("transfers");
  const [lineupPick, setLineupPick] = useState<number | null>(null); // player waiting for a swap or armband
  const [lineupMessage, setLineupMessage] = useState<string | null>(null);
  const replaceCardRef = useRef<HTMLElement>(null);
  const sellListRef = useRef<HTMLElement>(null);

  // Links from the player panel (?buy=, ?sell= or ?captain=) start the
  // Planner with that player chosen. The address is then tidied, so a
  // reload starts fresh.
  useEffect(() => {
    const request = plannerRequest(window.location.search, snapshot);
    if (!request) return;
    if (request.kind === "sell") setSwapOutId(request.playerId);
    if (request.kind === "buy") setBringInId(request.playerId);
    if (request.kind === "captain") setCaptains({ [snapshot.weeks[0]]: request.playerId });
    window.history.replaceState(null, "", "/planner");
  }, [snapshot]);

  // Recalculate the whole plan whenever a move, chip, captain or lineup changes.
  const freeHitSquads = useMemo(() => freeHitSquadsFrom(snapshot), [snapshot]);
  const plans = useMemo(
    () => simulatePlan(snapshot, moves, chips, freeHitSquads, captains, lineups),
    [snapshot, moves, chips, freeHitSquads, captains, lineups],
  );
  const baselineScore = useMemo(() => planScore(simulatePlan(snapshot, [])), [snapshot]);

  // Saved drafts: your last plan comes back when the Planner opens, and every
  // change is saved. A player-panel link (?captain=...) wins over the saved
  // captain for that week, and moves already made here aren't replaced.
  const currentDraft = useMemo<PlannerDraft>(() => ({ moves, chips, captains, lineups }), [moves, chips, captains, lineups]);
  const drafts = usePlannerDrafts({
    snapshot,
    current: currentDraft,
    onRestore: (draft) => {
      setMoves((planned) => (planned.length > 0 ? planned : draft.moves));
      setChips((planned) => ({ ...draft.chips, ...planned }));
      setCaptains((planned) => ({ ...draft.captains, ...planned }));
      setLineups((planned) => ({ ...draft.lineups, ...planned }));
    },
  });

  // Swaps the whole plan for a saved scenario.
  function loadScenario(draft: PlannerDraft) {
    setMoves(draft.moves);
    setChips(draft.chips);
    setCaptains(draft.captains);
    setLineups(draft.lineups);
    setSwapOutId(null);
    setBringInId(null);
    setLineupPick(null);
    setLineupMessage(null);
  }
  const totalScore = planScore(plans);
  const weekPlan = plans.find((plan) => plan.week === selectedWeek) ?? plans[0];
  const weekMoves = moves.filter((move) => move.week === selectedWeek);

  // Money available for a replacement before this week's moves are counted.
  const previousPlan = plans[plans.indexOf(weekPlan) - 1];
  const bankBeforeWeek = previousPlan ? previousPlan.bankAfter : snapshot.bank;

  function chooseWeek(week: number) {
    setSelectedWeek(week);
    setSwapOutId(null);
    setLineupPick(null);
    setLineupMessage(null);
  }

  // Lineup editing. The first player picked waits; the second is swapped
  // with him (or, if it's the same player, the pick is dropped). A refused
  // swap explains why instead of changing anything.
  function pickForLineup(id: number) {
    setLineupMessage(null);
    if (lineupPick === null || lineupPick === id) {
      setLineupPick(lineupPick === id ? null : id);
      return;
    }
    saveLineup(swapInLineup(lineupOf(weekPlan), lineupPick, id, players, selectedWeek));
  }

  // Gives the picked player the captain's or vice-captain's armband.
  function giveArmband(role: "captain" | "vice") {
    if (lineupPick !== null) saveLineup(setArmband(lineupOf(weekPlan), lineupPick, role));
  }

  // Keeps a lineup for the selected week, or shows why it was refused (and
  // drops the pick, so the next click starts fresh). The lineup now decides
  // the captain, so an earlier "Make captain" choice for this week is dropped.
  function saveLineup(result: LineupChoice | string) {
    if (typeof result === "string") {
      setLineupMessage(result);
      setLineupPick(null);
      return;
    }
    setLineups({ ...lineups, [selectedWeek]: result });
    setCaptains({ ...captains, [selectedWeek]: undefined });
    setLineupPick(null);
  }

  // Goes back to the model's best eleven and captain for the selected week.
  function resetLineup() {
    setLineups({ ...lineups, [selectedWeek]: undefined });
    setCaptains({ ...captains, [selectedWeek]: undefined });
    setLineupPick(null);
    setLineupMessage(null);
  }

  // Adds a move this week and closes whichever picker led to it.
  function addMove(outId: number, inId: number) {
    setMoves([...moves, { week: selectedWeek, outId, inId }]);
    setSwapOutId(null);
    setBringInId(null);
  }

  // A pitch click (or Sell on a phone) starts a normal "replace this player"
  // search, and drops any player waiting to be brought in. The replacement
  // list sits under the pitch (above the sell list on phones), so the page
  // scrolls just far enough to show it.
  function pickPlayerToReplace(id: number) {
    setBringInId(null);
    setSwapOutId(id);
    replaceCardRef.current?.scrollIntoView({ behavior: "smooth", block: window.matchMedia(PHONE_QUERY).matches ? "start" : "nearest" });
  }

  // Why selling `outId` for `inId` this week isn't allowed, or null if it is.
  function blockedReason(outId: number, inId: number): string | null {
    const incoming = players[inId];
    if (incoming.price > bankBeforeWeek + players[outId].sellingPrice) return "Too expensive";
    const clubCount = weekPlan.squad.filter((id) => id !== outId && players[id].team === incoming.team).length;
    return clubCount >= MAX_PER_CLUB ? `Already ${MAX_PER_CLUB} from ${incoming.team}` : null;
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
  const inPlayer = bringInId !== null ? players[bringInId] : null;
  // Your players he could replace this week, weakest first.
  const sellOptions = inPlayer
    ? weekPlan.squad.filter((id) => players[id].position === inPlayer.position).sort((a, b) => players[a].windowXp - players[b].windowXp)
    : [];
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
        {/* Hidden on phones, where the "Pick who to sell" list replaces the pitch. */}
        <div className="col-wide planner-pitch-col" style={{ flex: "1.25 1 660px" }}>
          <SegmentedControl
            label="What a click on the pitch does"
            layoutGroup="planner-pitch-mode"
            options={[{ value: "transfers", label: "Transfers" }, { value: "lineup", label: "Lineup" }]}
            value={pitchMode}
            onChange={(mode) => {
              setPitchMode(mode);
              setLineupPick(null);
              setLineupMessage(null);
            }}
          />
          <BroadcastPitch
            title={`GW${selectedWeek} SQUAD`}
            hint={pitchMode === "transfers" ? "Click a player to replace him" : "Click two players to swap them"}
            starters={weekPlan.starters}
            bench={weekPlan.bench}
            captain={weekPlan.captain}
            viceCaptain={weekPlan.viceCaptain}
            players={players}
            week={selectedWeek}
            selectedId={pitchMode === "transfers" ? swapOutId : lineupPick}
            incomingIds={incomingIds}
            onPlayerClick={pitchMode === "transfers" ? pickPlayerToReplace : pickForLineup}
          />

        </div>

        <div className="col-narrow" style={{ flex: "1 1 460px" }}>
          <section className="card planner-check">
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
            <div className="planner-captain">
              <span className="muted">Captain</span>
              <b>{players[weekPlan.captain].name}</b>
              <span className="muted">{weekPlan.captainChosen ? "your pick" : "highest xP"}</span>
              {captains[selectedWeek] !== undefined && (
                <button type="button" className="btn" onClick={() => setCaptains({ ...captains, [selectedWeek]: undefined })}>
                  Use highest xP
                </button>
              )}
            </div>
            {weekPlan.captainNotStarting && (
              <span className="chip warn planner-captain-note">
                {players[captains[selectedWeek]!].name} isn&apos;t in this week&apos;s best eleven
              </span>
            )}
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
                    {/* The coming week's moves can be marked as made on the FPL site, whoever suggested them. */}
                    {selectedWeek === weeks[0] && (
                      <MadeMoveButton gameweek={weeks[0]} out={move.outId} into={move.inId} marked={markedOuts.includes(move.outId)} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {/* Phones only: the pitch is hidden there, so this jumps to the sell list. */}
            <button type="button" className="btn phone-only planner-add-another" onClick={() => scrollIntoViewOnPhone(sellListRef.current)}>
              Add another transfer
            </button>
          </section>
          <MakeOrRollCard suggestion={matchingSuggestion(snapshot.suggestions, weekMoves, selectedWeek === weeks[0])} weeks={weeks} />
          {/* The five-week plan fills the column under the week's check, level with the pitch. */}
          {snapshot.solverPlan && (
            <SolverPlanCard
              plan={snapshot.solverPlan}
              snapshot={snapshot}
              onApply={() => {
                setMoves(solverMoves(snapshot.solverPlan!));
                setChips(solverChips(snapshot.solverPlan!));
                setLineups({}); // lineups picked for the old squad wouldn't fit the plan's
                setSwapOutId(null);
                setBringInId(null);
              }}
            />
          )}
          {/* Lineup mode on a Mac: the editor sits beside the pitch. */}
          {pitchMode === "lineup" && (
            <LineupEditor
              weekPlan={weekPlan}
              players={players}
              picked={lineupPick}
              message={lineupMessage}
              showList={false}
              className="lineup-editor-pitch desktop-only"
              onPick={pickForLineup}
              onArmband={giveArmband}
              onReset={resetLineup}
            />
          )}
        </div>
      </div>

      {/* The replacement table can run long, so it gets the full width under the pitch. */}
      <section className="card" ref={replaceCardRef}>
        {/* Crossfade between "Suggested moves" and "Replace ...": the old
            view fades out before the new one fades in. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={outPlayer ? `replace-${outPlayer.id}` : inPlayer ? `bring-${inPlayer.id}` : "suggested"}
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
                  <table className="planner-table">
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col" className="right">Price</th>
                        <th scope="col" className="right">Owned</th>
                        <th scope="col" className="right">xP next {weeks.length}</th>
                        <th scope="col" className="right">Gain</th>
                        <th scope="col"><span className="visually-hidden">Add</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((option) => {
                        const blocked = blockedReason(outPlayer.id, option.id);
                        return (
                          <tr key={option.id} style={{ opacity: blocked ? 0.5 : 1 }}>
                            <td><strong>{option.name}</strong> <span className="muted">{option.team}</span></td>
                            <td className="right">{formatPrice(option.price)}</td>
                            <td className="right muted">{option.ownership.toFixed(1)}%</td>
                            <td className="right"><b>{formatXp(option.windowXp)}</b></td>
                            <td className={gainClass(option.windowXp - outPlayer.windowXp)}>{formatGain(option.windowXp - outPlayer.windowXp)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn"
                                disabled={blocked !== null}
                                title={blocked ?? undefined}
                                onClick={() => addMove(outPlayer.id, option.id)}
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
            ) : inPlayer ? (
              <BringInView
                inPlayer={inPlayer}
                sellOptions={sellOptions}
                alreadyOwned={weekPlan.squad.includes(inPlayer.id)}
                week={selectedWeek}
                windowLength={weeks.length}
                players={players}
                blockedReason={blockedReason}
                onSell={(outId) => addMove(outId, inPlayer.id)}
                onCancel={() => setBringInId(null)}
              />
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
                  <span className="desktop-only">Or click any player on the pitch to search for a replacement yourself.</span>
                  <span className="phone-only">Or choose Sell on any player below to search for a replacement yourself.</span>
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
      <ScenariosCard drafts={drafts} snapshot={snapshot} freeHitSquads={freeHitSquads} currentScore={totalScore} onLoad={loadScenario} />
      <SellList
        ref={sellListRef}
        squad={weekPlan.squad}
        players={players}
        captain={weekPlan.captain}
        sellingIds={weekMoves.map((move) => move.outId)}
        selectedId={swapOutId}
        onSell={pickPlayerToReplace}
      />
      {/* Phones: always here, listing all 15 (the pitch is hidden there). */}
      <LineupEditor
        weekPlan={weekPlan}
        players={players}
        picked={lineupPick}
        message={lineupMessage}
        showList={pitchMode === "transfers"}
        className="phone-only"
        onPick={pickForLineup}
        onArmband={giveArmband}
        onReset={resetLineup}
      />
    </>
  );
}

// The lineup on show for a week (yours or the model's), in the shape the editing rules take.
function lineupOf(weekPlan: WeekPlan): LineupChoice {
  return { starters: weekPlan.starters, bench: weekPlan.bench, captain: weekPlan.captain, viceCaptain: weekPlan.viceCaptain };
}

// The sync's single-move suggestion that matches this week's plan, if any.
// Only those carry a value for rolling the transfer, so the card below
// can only judge a move the sync also looked at, and only in the first week.
function matchingSuggestion(suggestions: Suggestion[], weekMoves: PlannedMove[], isFirstWeek: boolean): Suggestion | null {
  if (!isFirstWeek || weekMoves.length !== 1) return null;
  const [move] = weekMoves;
  return suggestions.find((suggestion) => suggestion.out === move.outId && suggestion.in === move.inId) ?? null;
}

// "Make it now or roll?": the move's gain against the value of saving the
// free transfer for next week, using the sync's numbers. Hidden for any
// move the sync didn't suggest, since there's no roll value for it.
function MakeOrRollCard({ suggestion, weeks }: { suggestion: Suggestion | null; weeks: number[] }) {
  if (!suggestion) return null;
  const worthIt = suggestion.advice === "make";
  return (
    <section className="card" aria-label="Make it now or roll">
      <div className="card-head">
        <h2>Make it now or roll?</h2>
      </div>
      <ul className="list">
        <li>
          <span className="grow">This transfer, GW{weeks[0]} to GW{weeks[weeks.length - 1]}</span>
          <b className="gain">{formatGain(suggestion.gain)} xP</b>
        </li>
        {suggestion.hit_cost > 0 && (
          <li>
            <span className="grow">Points hit</span>
            <b className="bc-warn">-{suggestion.hit_cost}</b>
          </li>
        )}
        <li>
          <span className="grow">Value of rolling it</span>
          <b>{formatGain(suggestion.roll_value)} xP</b>
        </li>
      </ul>
      <p style={{ margin: 0 }}>
        <b className={worthIt ? "bc-accent" : "bc-warn"}>{worthIt ? "Make it:" : "Roll it:"}</b>{" "}
        {worthIt
          ? `worth ${formatXp(suggestion.net_gain)} xP more than rolling.`
          : `rolling is worth ${formatXp(-suggestion.net_gain)} xP more.`}
      </p>
    </section>
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
      <div className="solver-actions">
        <button type="button" className="btn primary" onClick={onApply}>Load into planner</button>
        <span className="muted">
          Replaces the moves and chips you&apos;ve planned so far.
          {!plan.finishedSearch && " The solver hit its time limit, so a slightly better plan may exist."}
        </span>
      </div>
    </section>
  );
}

// Lime for a gain, grey for no gain or a loss, so a minus never looks good.
function gainClass(gain: number): string {
  return gain > 0 ? "right gain" : "right muted";
}

interface BringInViewProps {
  inPlayer: Player;
  sellOptions: number[];
  alreadyOwned: boolean;
  week: number;
  windowLength: number;
  players: Record<string, Player>;
  blockedReason: (outId: number, inId: number) => string | null;
  onSell: (outId: number) => void;
  onCancel: () => void;
}

// "Bring in X": your players in his position, weakest first, each with a
// Sell button. Opened by "Add to plan" in the player panel.
function BringInView({ inPlayer, sellOptions, alreadyOwned, week, windowLength, players, blockedReason, onSell, onCancel }: BringInViewProps) {
  return (
    <>
      <div className="card-head">
        <h2>Bring in {inPlayer.name}</h2>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {inPlayer.team} {inPlayer.position}, {formatPrice(inPlayer.price)}, {formatXp(inPlayer.windowXp)} xP over the next {windowLength} weeks.
        {alreadyOwned ? ` He is already in your GW${week} squad.` : ` Pick who he replaces in GW${week}.`}
      </p>
      {!alreadyOwned && (
        <div className="table-wrap">
          <table className="planner-table">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="right">Sells for</th>
                <th scope="col" className="right">xP next {windowLength}</th>
                <th scope="col" className="right">Gain</th>
                <th scope="col"><span className="visually-hidden">Sell</span></th>
              </tr>
            </thead>
            <tbody>
              {sellOptions.map((id) => {
                const player = players[id];
                const blocked = blockedReason(id, inPlayer.id);
                return (
                  <tr key={id} style={{ opacity: blocked ? 0.5 : 1 }}>
                    <td><strong>{player.name}</strong> <span className="muted">{player.team}</span></td>
                    <td className="right">{formatPrice(player.sellingPrice)}</td>
                    <td className="right"><b>{formatXp(player.windowXp)}</b></td>
                    <td className={gainClass(inPlayer.windowXp - player.windowXp)}>{formatGain(inPlayer.windowXp - player.windowXp)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={blocked !== null}
                        title={blocked ?? undefined}
                        onClick={() => onSell(id)}
                        aria-label={`Sell ${player.name} for ${inPlayer.name}`}
                      >
                        Sell
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
