// The SquadSense logo: eleven dots in a 4-4-2 with one forward circled.
// Same artwork as docs/brand/squadsense-icon.svg, drawn inline so it
// uses the site's own accent and background colors.

// Dot centers on the 64 by 64 grid, goalkeeper at the bottom.
const PLAYERS: [number, number][] = [
  [32, 53],
  [14, 42], [26, 42], [38, 42], [50, 42],
  [14, 30], [26, 30], [38, 30], [50, 30],
  [25, 17], [39, 17],
];
const PICKED: [number, number] = [39, 17];

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
