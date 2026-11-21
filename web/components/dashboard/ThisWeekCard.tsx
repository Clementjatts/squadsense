// "This week": the two decisions for the coming deadline, captain and chip.
// This is the only place on the Dashboard where they're spelled out.

import { formatGain, formatXp } from "@/lib/format";
import { nextFixtures } from "@/lib/dashboard";
import type { ChipCard, Snapshot } from "@/lib/types";

export function ThisWeekCard({ snapshot }: { snapshot: Snapshot }) {
  const chip = snapshot.chipPlan.cards.find((card) => card.bestWeek === snapshot.gameweek);
  return (
    <section className="bc-card bc-thisweek">
      <div className="bc-thisweek-head">
        <span className="bc-title">THIS WEEK</span>
        <span className="bc-eyebrow">3 DECISIONS</span>
      </div>
      <TransferBlock snapshot={snapshot} />
      <CaptainBlock snapshot={snapshot} />
      <ChipBlock snapshot={snapshot} chip={chip} />
    </section>
  );
}

// The model's best single transfer, or why there isn't one.
function TransferBlock({ snapshot }: { snapshot: Snapshot }) {
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
              Over {snapshot.weeks.length} gameweeks · {move.advice === "make" ? "worth making now" : "worth less than rolling the transfer"}
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
            {fixture ? ` v ${fixture.label.replace(/ ([HA])$/, " ($1)")}` : ""} · {top.safety.toLowerCase()}
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
          <span className="bc-decision-number bc-decision-number-small">{formatGain(chip.gain ?? 0)}</span>
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
