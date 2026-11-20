// Price Watch page. The server loads the snapshot; filters, the watchlist
// and the countdown live in the PriceWatchView client component.

import { PriceWatchView } from "@/components/PriceWatchView";
import { TopBar } from "@/components/TopBar";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const { snapshot } = await getSnapshot();
  return (
    <>
      <TopBar title="Price Watch" subtitle="Prices change once a day at 00:00 UK" snapshot={snapshot} />
      <div className="content">
        <PriceWatchView watch={snapshot.priceWatch} checkedAt={snapshot.generatedAt} />
      </div>
    </>
  );
}
