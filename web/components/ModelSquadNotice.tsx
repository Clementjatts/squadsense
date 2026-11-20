// Explains that the squad on screen was picked by the model, because FPL
// keeps a new team's picks hidden until its first deadline passes.

import { formatDeadline } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

export function ModelSquadNotice({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.squadSource !== "model") return null;
  return (
    <div className="info-banner">
      Model-picked squad. FPL keeps your picks hidden until the GW{snapshot.gameweek} deadline (
      {formatDeadline(snapshot.deadline)} UK time), so this is the best GW{snapshot.gameweek} squad the model can find for
      £100m. Your own squad replaces it on the first sync after the deadline.
    </div>
  );
}
