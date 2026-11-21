// Live gameweek: points as matches happen, with provisional bonus,
// automatic substitutions and live mini-league tables. The numbers come
// from /api/live, which LiveView asks for once a minute.

import { LiveView } from "@/components/LiveView";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const { snapshot } = await getSnapshot();
  // Only names and clubs go to the browser, not the whole player list.
  const names = Object.fromEntries(
    Object.values(snapshot.players).map((player) => [String(player.id), { name: player.name, team: player.team }]),
  );
  return (
    <div className="bc-page">
      <LiveView names={names} />
    </div>
  );
}
