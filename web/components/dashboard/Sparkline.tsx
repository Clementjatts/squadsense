// A tiny line of a player's points in his last six gameweeks, with a dot
// on the latest. The scale tops out at 17 points (a strong haul), so
// lines can be compared from row to row.

const WIDTH = 76;
const HEIGHT = 24;
const TOP_POINTS = 17;

export function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return <span className="muted">No games yet</span>;
  const step = points.length > 1 ? (WIDTH - 6) / (points.length - 1) : 0;
  const coords = points.map((value, index) => [3 + index * step, HEIGHT - 3 - (Math.min(value, TOP_POINTS) / TOP_POINTS) * (HEIGHT - 6)]);
  const [lastX, lastY] = coords[coords.length - 1];
  return (
    <svg className="bc-spark" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Last ${points.length} gameweeks: ${points.join(", ")} points`}>
      <polyline points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
      <circle cx={lastX} cy={lastY} r="2.4" />
    </svg>
  );
}
