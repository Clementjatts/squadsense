// Dashboard: this week's projection and squad, the pitch, the two
// decisions for the deadline, then a squad analysis section with what to
// keep an eye on and what changed since earlier syncs. Each fact appears
// in one place only.

import { KeepAnEye } from "@/components/dashboard/KeepAnEye";
import { LineupBoard } from "@/components/dashboard/LineupBoard";
import { ProjectionCard } from "@/components/dashboard/ProjectionCard";
import { SquadCard } from "@/components/dashboard/SquadCard";
import { SquadTable } from "@/components/dashboard/SquadTable";
import { ThisWeekCard } from "@/components/dashboard/ThisWeekCard";
import { WhatChanged } from "@/components/dashboard/WhatChanged";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic"; // always read the latest snapshot

export default async function DashboardPage() {
  const { snapshot, isDemo } = await getSnapshot();
  const lineup = snapshot.lineups[String(snapshot.gameweek)];

  return (
    <div className="bc-page">
      {isDemo && <div className="demo-banner">Demo mode. These are made-up numbers. Run the sync job to see real FPL data.</div>}

      <div className="bc-grid-hero">
        <ProjectionCard snapshot={snapshot} />
        <SquadCard snapshot={snapshot} />
      </div>

      <div className="bc-grid-main">
        <LineupBoard lineup={lineup} players={snapshot.players} week={snapshot.gameweek} />
        <ThisWeekCard snapshot={snapshot} />
      </div>

      <div className="bc-section-head">
        <span className="bc-section-slash" aria-hidden="true" />
        <div>
          <h2 className="bc-section-title">SQUAD ANALYSIS</h2>
          <p className="bc-note">The detail behind the pitch: value, form, fixtures and what to keep an eye on</p>
        </div>
      </div>

      <div className="bc-grid-analysis">
        <SquadTable snapshot={snapshot} />
        <div className="bc-side-stack">
          <KeepAnEye snapshot={snapshot} />
          <WhatChanged snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}
