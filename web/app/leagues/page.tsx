// Mini-leagues: the league table, plus who your rivals own and captain.
// The interactive part lives in LeaguesView. Only the chosen league
// (?league=id, the smallest by default) is sent to the browser in full;
// the others carry just their name and size for the picker.

import { LeaguesView } from "@/components/LeaguesView";
import { PageHero } from "@/components/PageHero";
import { forOnePage, withOneLeague } from "@/lib/slim";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function LeaguesPage({ searchParams }: { searchParams: Promise<{ league?: string }> }) {
  const { snapshot } = await getSnapshot();
  const { league: chosenParam } = await searchParams;
  const leagues = snapshot.leagues ?? [];
  const picked = withOneLeague(leagues, Number(chosenParam));
  const rivalsRead = leagues.reduce((sum, league) => sum + league.rivalsWithPicks, 0);
  return (
    <div className="bc-page">
      <PageHero
        eyebrow={`RIVAL PICKS FROM GW${snapshot.gameweek - 1}`}
        title="MINI-LEAGUES"
        subtitle="What your rivals own and captain. Owning what they own keeps you level; owning what they don't is how you gain ground."
        figures={[
          { label: "Private leagues", value: leagues.length, accent: true },
          { label: "Rival squads read", value: rivalsRead },
        ]}
      />
      {leagues.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            No mini-leagues found. The sync shows every private league you&apos;re in, or only the ones listed in
            SQUADSENSE_LEAGUES.
          </p>
        </section>
      ) : (
        <LeaguesView snapshot={{ ...forOnePage(snapshot), leagues: picked.leagues }} chosenId={picked.chosen?.id ?? leagues[0].id} />
      )}
    </div>
  );
}
