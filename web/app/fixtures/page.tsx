// Fixture Ticker page. The server loads the snapshot; the toggles and
// table live in the FixtureTickerTable client component.

import { FixtureTickerTable } from "@/components/FixtureTickerTable";
import { PageHero } from "@/components/PageHero";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function FixturesPage() {
  const { snapshot } = await getSnapshot();
  const { weeks } = snapshot.fixtureTicker;
  // Clubs you own players from, for the "Highlight my teams" button.
  const myTeamIds = [...new Set(snapshot.squad.map((id) => snapshot.players[String(id)].teamId))];
  return (
    <div className="bc-page">
      <PageHero
        eyebrow={`GW${weeks[0]} TO GW${weeks[weeks.length - 1]}`}
        title="FIXTURE TICKER"
        subtitle="Every club's next run of games, easiest first. Switch between attackers and defenders below."
      />
      <FixtureTickerTable ticker={snapshot.fixtureTicker} myTeamIds={myTeamIds} />
    </div>
  );
}
