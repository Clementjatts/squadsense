// Hero card: this gameweek's projected points, big, with bars for the
// next five gameweeks if no transfers are made.

import { formatXp } from "@/lib/format";
import { formation } from "@/lib/dashboard";
import type { Snapshot } from "@/lib/types";

const BAR_MIN = 22; // px, so the lowest week still shows a bar
const BAR_RANGE = 70; // px between the lowest and highest week

export function ProjectionCard({ snapshot }: { snapshot: Snapshot }) {
  const lineup = snapshot.lineups[String(snapshot.gameweek)];
  const weeks = snapshot.weeks.map((week) => ({ week, xp: snapshot.lineups[String(week)].expected_points }));
  const lowest = Math.min(...weeks.map((item) => item.xp));
  const highest = Math.max(...weeks.map((item) => item.xp));
  const spread = highest - lowest || 1;

  return (
    <section className="bc-card bc-hero">
      <span className="bc-slash bc-slash-wide" aria-hidden="true" />
      <span className="bc-slash bc-slash-thin" aria-hidden="true" />
      <span className="bc-eyebrow bc-accent">GAMEWEEK {snapshot.gameweek} · PROJECTED POINTS</span>
      <div className="bc-hero-body">
        <span className="bc-giant">{formatXp(lineup.expected_points)}</span>
        <div className="bc-bars" role="img" aria-label={weeks.map((item) => `GW${item.week} ${formatXp(item.xp)}`).join(", ")}>
          {weeks.map((item, index) => (
            <div key={item.week} className="bc-bar-col">
              <span className="bc-bar-value">{formatXp(item.xp)}</span>
              <span
                className={index === 0 ? "bc-bar bc-bar-now" : "bc-bar"}
                style={{ height: BAR_MIN + (BAR_RANGE * (item.xp - lowest)) / spread }}
              />
              <span className="bc-bar-label">GW{item.week}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="bc-note">
        Best XI in a {formation(lineup.starters, snapshot.players)} · bars show the next five gameweeks with no transfers
      </span>
    </section>
  );
}
