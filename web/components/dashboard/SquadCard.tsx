// Hero card: money and transfers, plus the way into the Planner.

import Link from "next/link";
import { formatFreeTransfers, formatPrice } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

export function SquadCard({ snapshot }: { snapshot: Snapshot }) {
  const stats = [
    { label: "Bank", value: formatPrice(snapshot.bank) },
    { label: "Free transfers", value: formatFreeTransfers(snapshot.freeTransfers) },
    { label: "Squad value", value: formatPrice(snapshot.squadValue) },
  ];
  return (
    <section className="bc-card bc-squad">
      <span className="bc-eyebrow">YOUR SQUAD</span>
      <div className="bc-stat-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="bc-stat">
            <span className="bc-stat-label">{stat.label}</span>
            <span className="bc-stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
      <div className="bc-squad-foot">
        <span className="bc-note">
          {snapshot.squadSource === "model"
            ? "Model-picked squad until your picks go public"
            : "Bank and selling prices are estimated from public data"}
        </span>
        <Link href="/planner" className="bc-button">
          OPEN PLANNER
        </Link>
      </div>
    </section>
  );
}
