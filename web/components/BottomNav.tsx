"use client";

// The tab bar fixed to the bottom of the screen on phones. It holds the
// four pages used most (Squad, Plan, Fixtures, Prices) and a More tab that
// opens a short menu with the rest. On wider screens the CSS hides it and
// the header's page links take over.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Pages reached from the More menu, in the order the menu lists them.
const MORE_PAGES = [
  { label: "Chips", href: "/chips", note: "When to play each chip" },
  { label: "Leagues", href: "/leagues", note: "Mini-leagues, threats and differentials" },
  { label: "Review", href: "/review", note: "Last week against the forecast" },
  { label: "Live", href: "/live", note: "Points during the gameweek" },
  { label: "Compare", href: "/compare", note: "Up to three players side by side" },
];

// The four main tabs. `matches` lists every route that lights the tab up:
// "Your plan explained" (/plan) belongs to the Plan tab.
const MAIN_TABS = [
  { label: "Squad", href: "/", matches: ["/"], icon: "M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z" },
  { label: "Plan", href: "/planner", matches: ["/planner", "/plan"], icon: "M4 7h13l-3-3M20 17H7l3 3" },
  { label: "Fixtures", href: "/fixtures", matches: ["/fixtures"], icon: "M3 10h18M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" },
  { label: "Prices", href: "/prices", matches: ["/prices"], icon: "M4 17l6-6 4 4 6-7M15 8h5v5" },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const onMorePage = MORE_PAGES.some((page) => page.href === pathname);

  // Close the menu whenever the page changes, so a chosen link never leaves it open.
  useEffect(() => setMoreOpen(false), [pathname]);

  // While the menu is open, Escape closes it and keyboard focus moves to its first link.
  useEffect(() => {
    if (!moreOpen) return;
    menuRef.current?.querySelector("a")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      {moreOpen && <div className="bottomnav-backdrop" aria-hidden="true" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="bottomnav-menu" ref={menuRef} id="more-menu" role="menu" aria-label="More pages">
          {MORE_PAGES.map((page) => (
            <Link key={page.href} href={page.href} role="menuitem" className="bottomnav-menu-item" aria-current={page.href === pathname ? "page" : undefined}>
              <b>{page.label}</b>
              <span>{page.note}</span>
            </Link>
          ))}
        </div>
      )}
      <nav className="bottomnav" aria-label="Main on phones">
        {MAIN_TABS.map((tab) => {
          const isActive = tab.matches.includes(pathname) && !moreOpen;
          return (
            <Link key={tab.href} href={tab.href} className="bottomnav-tab" aria-current={isActive ? "page" : undefined}>
              <TabIcon path={tab.icon} />
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          className="bottomnav-tab"
          aria-expanded={moreOpen}
          aria-controls="more-menu"
          data-active={onMorePage || moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <TabIcon path={moreOpen ? "M6 6l12 12M18 6L6 18" : "M5 12h.01M12 12h.01M19 12h.01"} />
          {moreOpen ? "Close" : "More"}
        </button>
      </nav>
    </>
  );
}

// One stroked 24 x 24 icon above a tab's label.
function TabIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
