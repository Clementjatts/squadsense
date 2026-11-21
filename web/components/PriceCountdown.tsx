"use client";

// Time left until FPL's daily price change at 00:00 UK, for the Price
// Watch hero. Worked out in the browser after the page loads, so the
// server and browser never disagree, and refreshed every 30 seconds.

import { useEffect, useState } from "react";

// Minutes from `now` until the next midnight in London, which handles the
// clocks changing between GMT and BST.
function minutesUntilUkMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return 24 * 60 - (hour * 60 + minute);
}

export function PriceCountdown() {
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setMinutesLeft(minutesUntilUkMidnight(new Date()));
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="bc-hero-figure">
      <span className="bc-stat-label">Next price change</span>
      <span className="bc-hero-figure-value bc-accent">
        {minutesLeft === null ? "00:00" : `${Math.floor(minutesLeft / 60)}h ${String(minutesLeft % 60).padStart(2, "0")}m`}
      </span>
    </div>
  );
}
