// Mini-leagues: the league table, plus who your rivals own and captain.
// The interactive part (switching league) lives in LeaguesView.

import { LeaguesView } from "@/components/LeaguesView";
import { PageHero } from "@/components/PageHero";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function LeaguesPage() {
  const { snapshot } = await getSnapshot();
  const leagues = snapshot.leagues ?? [];
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
        <LeaguesView snapshot={snapshot} />
      )}
    </div>
  );
}
