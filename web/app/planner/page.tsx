// Transfer Planner page. The server loads the snapshot; the interactive
// part lives in the Planner client component.

import { ModelSquadNotice } from "@/components/ModelSquadNotice";
import { Planner } from "@/components/Planner";
import { TopBar } from "@/components/TopBar";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const { snapshot } = await getSnapshot();
  const firstWeek = snapshot.weeks[0];
  const lastWeek = snapshot.weeks[snapshot.weeks.length - 1];
  return (
    <>
      <TopBar
        title="Transfer Planner"
        subtitle={`Test moves for GW${firstWeek} to GW${lastWeek}. Nothing changes on FPL until you make them there.`}
        snapshot={snapshot}
      />
      <div className="content">
        <ModelSquadNotice snapshot={snapshot} />
        <Planner snapshot={snapshot} />
      </div>
    </>
  );
}
