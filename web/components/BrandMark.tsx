// The SquadSense logo: eleven dots in a 4-4-2 with one forward circled.
// Same artwork as docs/brand/squadsense-icon.svg, drawn inline so it
// uses the site's own accent and background colors.

import { FORMATION_DOTS as PLAYERS, PICKED_DOT as PICKED } from "@/lib/formationDots";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" style={{ fill: "var(--accent)" }} />
      <g style={{ fill: "var(--bg)" }}>
        {PLAYERS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="3.8" />
        ))}
      </g>
      <circle cx={PICKED[0]} cy={PICKED[1]} r="7.2" fill="none" strokeWidth="2.4" style={{ stroke: "var(--bg)" }} />
    </svg>
  );
}
