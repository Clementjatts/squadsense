// "Keep an eye on": warnings about your players (injuries, bookings,
// minutes) and chips worth saving for later weeks. Prices live in the
// table and this week's chip in "This week", so neither repeats here.

import { formatXp } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

const FLAG_TAGS = { injury: "INJURY", suspension: "CARDS", rotation: "MINUTES" } as const;

interface Item {
  key: string;
  tag: string;
  tone: "warn" | "info";
  title: string;
  detail: string;
}

// Splits "On 4 yellows. One more before match 19 means a ban." into the
// headline ("On 4 yellows") and the rest, so each fits on its own line.
function splitMessage(message: string): { headline: string; rest: string } {
  const breakAt = message.indexOf(". ");
  if (breakAt === -1) return { headline: message.replace(/\.$/, ""), rest: "" };
  return { headline: message.slice(0, breakAt), rest: message.slice(breakAt + 2) };
}

// Player warnings first, then later chips in gameweek order.
function collectItems(snapshot: Snapshot): Item[] {
  const warnings: Item[] = snapshot.flags.map((flag) => {
    const { headline, rest } = splitMessage(flag.message);
    return {
      key: `${flag.playerId}-${flag.kind}`,
      tag: FLAG_TAGS[flag.kind],
      tone: "warn",
      title: `${snapshot.players[String(flag.playerId)].name} · ${headline}`,
      detail: rest,
    };
  });
  // Chips the strategy plays or saves for a later week, in week order.
  const laterChips: Item[] = snapshot.chipPlan.cards
    .filter((card) => card.decision && card.decision.week !== null && card.decision.week > snapshot.gameweek && card.decision.action !== "none")
    .sort((a, b) => (a.decision!.week ?? 0) - (b.decision!.week ?? 0))
    .map((card) => ({
      key: card.chip,
      tag: "CHIP",
      tone: "info",
      title: `${card.label}: ${card.decision!.action === "play" ? "play" : "saved for"} GW${card.decision!.week}`,
      detail: `Worth about ${formatXp(card.decision!.gain ?? 0)} xP that week`,
    }));
  return [...warnings, ...laterChips];
}

export function KeepAnEye({ snapshot }: { snapshot: Snapshot }) {
  const items = collectItems(snapshot);
  return (
    <section className="bc-card bc-eye">
      <div className="bc-eye-head">
        <span className="bc-title-small">KEEP AN EYE ON</span>
        <span className="bc-eyebrow">{items.length}</span>
      </div>
      {items.length === 0 && <p className="bc-eye-empty">Nothing needs your attention right now.</p>}
      {items.map((item) => (
        <div key={item.key} className="bc-eye-row">
          <span className={item.tone === "warn" ? "bc-tag bc-tag-warn" : "bc-tag bc-tag-info"}>{item.tag}</span>
          <span className="bc-eye-text">
            <b>{item.title}</b>
            {item.detail && <span>{item.detail}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}
