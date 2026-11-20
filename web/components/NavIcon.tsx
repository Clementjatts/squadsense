// The 20px line icons beside each sidebar link, copied from the design
// canvas (docs/design/desktop/Desktop-Dashboard.dc.html). They draw in the
// link's text color, and the active page's icon turns lime in globals.css.

const ICON_PATHS: Record<string, string[]> = {
  Dashboard: ["M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"],
  "Transfer Planner": ["M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"],
  Fixtures: ["M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 10h18M8 3v4M16 3v4"],
  "Price Watch": ["M3 17l6-6 4 4 8-8M15 7h6v6"],
  Chips: ["M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z"],
  "Champions League": ["M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"],
  "Alerts and settings": ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"],
};

export function NavIcon({ label }: { label: string }) {
  const paths = ICON_PATHS[label];
  if (!paths) {
    // A new page without an icon still works; it just shows its label alone.
    console.warn(`No sidebar icon for "${label}"`);
    return null;
  }
  return (
    <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
