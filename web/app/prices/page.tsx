// Price Watch page. The hero carries the countdown to tonight's change;
// filters and the watchlist live in the PriceWatchView client component.

import { PageHero } from "@/components/PageHero";
import { PriceCountdown } from "@/components/PriceCountdown";
import { PriceWatchView } from "@/components/PriceWatchView";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const { snapshot } = await getSnapshot();
  return (
    <div className="bc-page">
      <PageHero
        eyebrow="FPL'S OWN PRICE PREDICTOR"
        title="PRICE WATCH"
        subtitle="Prices change once a day at 00:00 UK. Over 100% means FPL expects a change at the next one."
      >
        <PriceCountdown />
      </PageHero>
      <PriceWatchView watch={snapshot.priceWatch} />
    </div>
  );
}
