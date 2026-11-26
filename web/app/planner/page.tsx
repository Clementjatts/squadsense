// Transfer Planner page. The server loads the snapshot; everything on the
// page, including its hero figures, lives in the Planner client component
// because it changes as you plan. The server also reads which coming-week
// moves are marked "Done on FPL". It gets the snapshot without the parts
// other pages use (lib/slim.ts), since all of it is sent to the browser.

import { Planner } from "@/components/Planner";
import { madeMovesForPage } from "@/lib/madeMoves";
import { forOnePage } from "@/lib/slim";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const { snapshot } = await getSnapshot();
  // Moves already marked "Done on FPL" for the coming week, so their buttons show them as made.
  const marks = await madeMovesForPage(snapshot.weeks[0]);
  return (
    <div className="bc-page">
      <Planner snapshot={forOnePage(snapshot)} markedOuts={[...marks.marked]} />
    </div>
  );
}
