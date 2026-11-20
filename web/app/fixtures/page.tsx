// Fixture Ticker page. The server loads the snapshot; the toggles and
// table live in the FixtureTickerTable client component.

import { FixtureTickerTable } from "@/components/FixtureTickerTable";
import { TopBar } from "@/components/TopBar";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function FixturesPage() {
  const { snapshot } = await getSnapshot();
  const { weeks } = snapshot.fixtureTicker;
  // Clubs you own players from, for the "Highlight my teams" button.
  const myTeamIds = [...new Set(snapshot.squad.map((id) => snapshot.players[String(id)].teamId))];

  return (
    <>
      <TopBar
        title="Fixture Ticker"
        subtitle={`Best runs first, GW${weeks[0]} to GW${weeks[weeks.length - 1]}`}
        snapshot={snapshot}
      />
      <div className="content">
        <FixtureTickerTable ticker={snapshot.fixtureTicker} myTeamIds={myTeamIds} />
      </div>
    </>
  );
}
