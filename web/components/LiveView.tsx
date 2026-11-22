"use client";

// The Live page body. Asks /api/live for fresh numbers every minute while
// the tab is open, and shows your eleven, the fixtures and live league tables.

import { useEffect, useState } from "react";
import { PageHero } from "./PageHero";
import { PlayerLink } from "./PlayerPanel";

const REFRESH_MS = 60_000;

interface LiveLine {
  element: number;
  multiplier: number;
  subbedOn: boolean;
  points: number;
  provisionalBonus: number;
  minutes: number;
  status: "done" | "playing" | "waiting";
}

interface LiveResponse {
  gameweek: number;
  fetchedAt: string;
  mine: { points: number; hits: number; lineup: LiveLine[]; subs: { out: number; in: number }[]; playersLeft: number } | null;
  leagues: { id: number; name: string; rows: { entry: number; teamName: string; live: number; total: number; chip: string | null; playersLeft: number }[] }[];
  fixtures: { id: number; home: string; away: string; homeScore: number | null; awayScore: number | null; minutes: number; status: string }[];
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: LiveResponse };

// Fetches /api/live now and then every REFRESH_MS. A failed refresh keeps
// the last good numbers on screen and shows the error.
function useLiveData(): LoadState {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/live", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
        if (!cancelled) setState({ kind: "ready", data: body as LiveResponse });
      } catch (error) {
        if (!cancelled) setState((previous) => (previous.kind === "ready" ? previous : { kind: "error", message: (error as Error).message }));
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return state;
}

export function LiveView({ names }: { names: Record<string, { name: string; team: string }> }) {
  const state = useLiveData();
  if (state.kind !== "ready") {
    return (
      <>
        <PageHero eyebrow="LIVE" title="LIVE GAMEWEEK" subtitle="Points as the matches happen, refreshed every minute." />
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>{state.kind === "loading" ? "Loading live points..." : `Couldn't load live points: ${state.message}`}</p>
        </section>
      </>
    );
  }
  const { data } = state;
  const played = data.fixtures.filter((fixture) => fixture.status === "done").length;
  return (
    <>
      <PageHero
        eyebrow={`GW${data.gameweek} · UPDATED ${new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
        title="LIVE GAMEWEEK"
        subtitle="Points as the matches happen, with provisional bonus and automatic subs worked out the way FPL will."
        figures={[
          { label: data.mine && data.mine.hits > 0 ? `Live points (-${data.mine.hits} hits)` : "Live points", value: data.mine ? data.mine.points : "-", accent: true },
          { label: "Starters still to finish", value: data.mine ? data.mine.playersLeft : "-" },
          { label: "Matches finished", value: `${played} / ${data.fixtures.length}` },
        ]}
      />
      <div className="row">
        <div className="col-wide" style={{ flex: "1.3 1 600px" }}>
          {data.mine ? <MyLineup mine={data.mine} names={names} /> : (
            <section className="card"><p className="muted" style={{ margin: 0 }}>Your team has no picks for this gameweek yet.</p></section>
          )}
        </div>
        <div className="col-narrow" style={{ flex: "1 1 400px" }}>
          {data.leagues.length > 0 && <LiveLeagues leagues={data.leagues} />}
          <FixtureList fixtures={data.fixtures} />
        </div>
      </div>
    </>
  );
}

const STATUS_LABELS = { done: "Finished", playing: "Playing", waiting: "Not started" };

// Your counted players, in a fixed-height row each, with subs marked.
function MyLineup({ mine, names }: { mine: NonNullable<LiveResponse["mine"]>; names: Record<string, { name: string; team: string }> }) {
  const name = (id: number) => names[String(id)]?.name ?? `#${id}`;
  return (
    <section className="bc-card bc-table-card">
      <div className="table-wrap">
        <table className="bc-table live-table">
          <colgroup>
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">PLAYER</th>
              <th scope="col">STATUS</th>
              <th scope="col" className="right">MINS</th>
              <th scope="col" className="right">BONUS</th>
              <th scope="col" className="right">POINTS</th>
            </tr>
          </thead>
          <tbody>
            {mine.lineup.map((line) => (
              <tr key={line.element}>
                <td className="bc-cell-name">
                  <PlayerLink id={line.element} name={name(line.element)} />
                  {line.multiplier > 1 && <span className="bc-set-tag">{line.multiplier === 3 ? "TC" : "C"}</span>}
                  {line.subbedOn && <span className="bc-set-tag">SUB</span>}
                </td>
                <td className={line.status === "playing" ? "bc-accent" : "muted"}>{STATUS_LABELS[line.status]}</td>
                <td className="right bc-cell-num">{line.minutes}</td>
                <td className="right bc-cell-num muted">{line.provisionalBonus > 0 ? `+${line.provisionalBonus}?` : "-"}</td>
                <td className="right bc-cell-num bc-cell-strong">{line.points * line.multiplier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine.subs.length > 0 && (
        <p className="bc-note" style={{ padding: "0 16px 14px" }}>
          Automatic subs: {mine.subs.map((sub) => `${name(sub.in)} for ${name(sub.out)}`).join(", ")}.
        </p>
      )}
    </section>
  );
}

// Live mini-league tables, one league at a time.
function LiveLeagues({ leagues }: { leagues: LiveResponse["leagues"] }) {
  const [leagueId, setLeagueId] = useState(leagues[0].id);
  const league = leagues.find((candidate) => candidate.id === leagueId) ?? leagues[0];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Live tables</h2>
        {leagues.length > 1 ? (
          <select className="bc-select" aria-label="League" value={league.id} onChange={(event) => setLeagueId(Number(event.target.value))}>
            {leagues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : (
          <span className="muted">{league.name}</span>
        )}
      </div>
      <ol className="share-list">
        {league.rows.map((row, index) => (
          <li key={row.entry} className="live-row">
            <span className="muted num">{index + 1}</span>
            <span className="share-name">{row.teamName}</span>
            <span className="num muted">+{row.live}</span>
            <b className="num">{row.total}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

// This week's matches with scores.
function FixtureList({ fixtures }: { fixtures: LiveResponse["fixtures"] }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Matches</h2></div>
      <ul className="share-list">
        {fixtures.map((fixture) => (
          <li key={fixture.id} className="live-fixture">
            <span>{fixture.home}</span>
            <b className="num">{fixture.homeScore ?? "-"} : {fixture.awayScore ?? "-"}</b>
            <span>{fixture.away}</span>
            <span className={fixture.status === "playing" ? "bc-accent" : "muted"}>
              {fixture.status === "playing" ? `${fixture.minutes}'` : fixture.status === "done" ? "FT" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
