// The strip across the top of each page: title on the left, the numbers
// you check constantly on the right.

import { formatDeadline, formatFreeTransfers, formatPrice } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

interface TopBarProps {
  title: string;
  subtitle: string;
  snapshot: Snapshot;
}

export function TopBar({ title, subtitle, snapshot }: TopBarProps) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="stats">
        <div className="stat">
          <span>
            <span className="gw-badge">GW{snapshot.gameweek}</span>
            Deadline
          </span>
          <b>{formatDeadline(snapshot.deadline)}</b>
        </div>
        <div className="stat">
          <span>Bank (est.)</span>
          <b>{formatPrice(snapshot.bank)}</b>
        </div>
        <div className="stat">
          <span>Free transfers</span>
          <b>{formatFreeTransfers(snapshot.freeTransfers)}</b>
        </div>
        <div className="stat">
          <span>Squad value</span>
          <b>{formatPrice(snapshot.squadValue)}</b>
        </div>
      </div>
    </header>
  );
}
