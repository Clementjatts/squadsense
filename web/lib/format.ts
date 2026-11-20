// Small helpers for showing numbers the same way on every screen.

// FPL prices are tenths of a million, so 145 becomes "£14.5m".
export function formatPrice(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

// null free transfers means unlimited (a team's first gameweek).
export function formatFreeTransfers(count: number | null): string {
  return count === null ? "Unlimited" : String(count);
}

// Big transfer counts as "+182k" or "-1.2m", always with a sign.
export function formatCount(count: number): string {
  const sign = count >= 0 ? "+" : "-";
  const size = Math.abs(count);
  if (size >= 1_000_000) return `${sign}${(size / 1_000_000).toFixed(1)}m`;
  if (size >= 1_000) return `${sign}${Math.round(size / 1_000)}k`;
  return `${sign}${size}`;
}

export function formatXp(points: number): string {
  return points.toFixed(1);
}

// Shows "+5.4" or "-0.9" for differences, so the sign is never missing.
export function formatGain(points: number): string {
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}`;
}

// Turns the deadline into "Sat 11:00" in UK time.
export function formatDeadline(isoTime: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(isoTime));
}
