"use client";

// Left-hand navigation. It's a client component only because it needs
// the current URL to highlight the page you're on.

import Link from "next/link";
import { usePathname } from "next/navigation";

const LIVE_PAGES = [
  { label: "Dashboard", href: "/" },
  { label: "Transfer Planner", href: "/planner" },
  { label: "Fixtures", href: "/fixtures" },
  { label: "Price Watch", href: "/prices" },
  { label: "Chips", href: "/chips" },
];
// Designed but not built yet. Shown so the layout matches the design.
const COMING_SOON = ["Champions League", "Alerts and settings"];

interface SidebarProps {
  teamName: string;
  teamId: number;
  syncedAt: string;
  isDemo: boolean;
}

export function Sidebar({ teamName, teamId, syncedAt, isDemo }: SidebarProps) {
  const pathname = usePathname();
  const syncedTime = new Date(syncedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        SquadSense
      </div>
      <div className="team-box">
        <strong>{teamName}</strong>
        <div className="muted">ID {teamId}</div>
      </div>
      <nav className="nav" aria-label="Main">
        <span className="nav-label">FANTASY PREMIER LEAGUE</span>
        {LIVE_PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="nav-link" aria-current={pathname === page.href ? "page" : undefined}>
            {page.label}
          </Link>
        ))}
        {COMING_SOON.map((label) => (
          <span key={label} className="nav-link soon" aria-disabled="true">
            {label} <span className="chip">Soon</span>
          </span>
        ))}
      </nav>
      <div className="sync-box">
        {isDemo ? "Demo mode: sample data, not your real team." : `Data synced ${syncedTime}.`} Bank and selling
        prices are estimated from public data.
      </div>
    </aside>
  );
}
