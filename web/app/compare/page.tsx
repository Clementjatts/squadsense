// Player comparison: up to three players side by side. The ids live in
// the address (?ids=1,2,3) so a comparison can be bookmarked or shared.

import { CompareView } from "@/components/CompareView";
import { PageHero } from "@/components/PageHero";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  const initialIds = (ids ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 3);
  return (
    <div className="bc-page">
      <PageHero
        eyebrow="UP TO THREE PLAYERS"
        title="COMPARE PLAYERS"
        subtitle="Side by side on price, expected points, this season's numbers and the fixtures ahead. The best value in each row is lit up."
      />
      <CompareView initialIds={initialIds} />
    </div>
  );
}
