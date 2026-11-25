// "What changed": what moved since earlier syncs (xP, injury news,
// prices, the plan and chip decisions), newest first. Written by the
// sync job (jobs/squadsense/changes.py); this card only shows it. Beside
// "Keep an eye on" it takes that card's height and scrolls inside, so the
// two always end on the same line however much has changed.

import type { Snapshot } from "@/lib/types";

const ENTRIES_SHOWN = 4;

// "Sat 21 Nov, 16:32" in UK time.
function formatWhen(isoTime: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  }).format(new Date(isoTime));
}

export function WhatChanged({ snapshot }: { snapshot: Snapshot }) {
  const feed = (snapshot.changes ?? []).slice(0, ENTRIES_SHOWN);
  return (
    <section className="bc-card bc-eye changes-card">
      <div className="bc-eye-head">
        <span className="bc-title-small">WHAT CHANGED</span>
        <span className="bc-eyebrow">SINCE EARLIER SYNCS</span>
      </div>
      {feed.length === 0 && <p className="bc-eye-empty">Nothing has moved since the last sync.</p>}
      <div className="changes-feed">
        {feed.map((entry) => (
          <div key={entry.at} className="changes-entry">
            <span className="muted changes-when">{formatWhen(entry.at)}</span>
            <ul>{entry.changes.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}
