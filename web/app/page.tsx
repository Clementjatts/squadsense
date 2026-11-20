// Dashboard: this week's lineup, the suggested move, captain options and warnings.

import Link from "next/link";
import { ModelSquadNotice } from "@/components/ModelSquadNotice";
import { PlayerLink } from "@/components/PlayerPanel";
import { PlayerPitch } from "@/components/PlayerPitch";
import { TopBar } from "@/components/TopBar";
import { formatGain, formatPrice, formatXp } from "@/lib/format";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic"; // always read the latest snapshot

export default async function DashboardPage() {
  const { snapshot, isDemo } = await getSnapshot();
  const { players, gameweek } = snapshot;
  const lineup = snapshot.lineups[String(gameweek)];
  const topMove = snapshot.suggestions[0];

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Everything you need for the GW${gameweek} deadline`} snapshot={snapshot} />
      <div className="content">
        {isDemo && (
          <div className="demo-banner">
            Demo mode. These are made-up numbers. Run the sync job to see real FPL data.
          </div>
        )}
        <ModelSquadNotice snapshot={snapshot} />
        <div className="row">
          <div className="col-wide">
            <section className="card">
              <div className="card-head">
                <h2>Your GW{gameweek} lineup</h2>
                <span className="muted">
                  Team xP <b>{formatXp(lineup.expected_points)}</b>
                </span>
              </div>
              <PlayerPitch starters={lineup.starters} captain={lineup.captain} players={players} week={gameweek} />
              <div className="bench" aria-label="Bench">
                {lineup.bench.map((id, index) => (
                  <div className="bench-item" key={id}>
                    <span className="muted">{index === 0 ? "GK" : index} </span>
                    <strong>
                      <PlayerLink id={id} name={players[id].name} />
                    </strong>
                    <div className="muted">
                      {players[id].team} · {formatXp(players[id].xp[String(gameweek)] ?? 0)} xP
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="col-narrow">
            {topMove && (
              <section className="card highlight">
                <span className="eyebrow">THIS WEEK&apos;S MOVE</span>
                <span className="big">
                  {players[topMove.out].name} → {players[topMove.in].name}
                </span>
                <span className="muted">
                  {formatGain(topMove.gain)} xP over {snapshot.weeks.length} gameweeks, leaves{" "}
                  {formatPrice(topMove.bank_after)} in the bank.{" "}
                  {topMove.advice === "make" ? "Worth making now." : "Worth less than rolling the transfer."}
                </span>
                <div>
                  <Link className="btn primary" href="/planner">
                    Open in planner
                  </Link>
                </div>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>Captain</h2>
              </div>
              <ol className="list">
                {snapshot.captainOptions.slice(0, 3).map((option, index) => (
                  <li key={option.playerId}>
                    <span className="muted">{index + 1}</span>
                    <span className="grow">
                      <strong>
                        <PlayerLink id={option.playerId} name={players[option.playerId].name} />
                      </strong>
                      <span className="muted">
                        {players[option.playerId].team} · {option.safety}
                      </span>
                    </span>
                    <span className="big num">{formatXp(option.xp)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Watch out</h2>
                <span className="muted">{snapshot.flags.length} flags</span>
              </div>
              {snapshot.flags.length === 0 ? (
                <p className="muted">Nothing to worry about this week.</p>
              ) : (
                <ul className="list">
                  {snapshot.flags.map((flag) => (
                    <li key={`${flag.playerId}-${flag.kind}`} style={{ alignItems: "flex-start" }}>
                      <span className="warn-icon" aria-hidden="true" />
                      <span className="grow">
                        <strong>
                          <PlayerLink id={flag.playerId} name={players[flag.playerId].name} />
                        </strong>
                        <span className="muted">{flag.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
