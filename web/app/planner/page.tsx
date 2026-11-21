// Transfer Planner page. The server loads the snapshot; everything on the
// page, including its hero figures, lives in the Planner client component
// because it changes as you plan.

import { Planner } from "@/components/Planner";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const { snapshot } = await getSnapshot();
  return (
    <div className="bc-page">
      <Planner snapshot={snapshot} />
    </div>
  );
}
