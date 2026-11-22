"use client";

// The header on every page: logo, page links and the gameweek deadline.
// It's a client component because it highlights the page you're on, and
// the lime highlight slides between links when you change page. On phones
// the page links are hidden and BottomNav's tab bar is used instead.

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDeadline } from "@/lib/format";
import { BottomNav } from "./BottomNav";
import { BrandMark } from "./BrandMark";
import { AccountMenu } from "./AccountMenu";
import { SearchPalette } from "./SearchPalette";

const PAGES = [
  { label: "Dashboard", href: "/" },
  { label: "Planner", href: "/planner" },
  { label: "Fixtures", href: "/fixtures" },
  { label: "Prices", href: "/prices" },
  { label: "Chips", href: "/chips" },
  { label: "Leagues", href: "/leagues" },
  { label: "Review", href: "/review" },
  { label: "Live", href: "/live" },
];

interface TopNavProps {
  gameweek: number;
  deadline: string;
}

export function TopNav({ gameweek, deadline }: TopNavProps) {
  const pathname = usePathname();
  return (
    <header className="topnav">
      <Link href="/" className="topnav-brand" aria-label="SquadSense home">
        <BrandMark size={40} />
        <span className="topnav-wordmark">SQUADSENSE</span>
      </Link>
      <nav className="topnav-links" aria-label="Main">
        {PAGES.map((page) => {
          const isActive = pathname === page.href;
          return (
            <Link key={page.href} href={page.href} className="topnav-link" aria-current={isActive ? "page" : undefined}>
              {isActive && (
                <motion.span className="topnav-pill" layoutId="topnav-active-pill" aria-hidden="true" transition={{ type: "spring", stiffness: 420, damping: 38 }} />
              )}
              <span className="topnav-label">{page.label}</span>
            </Link>
          );
        })}
      </nav>
      <SearchPalette />
      <AccountMenu />
      <div className="topnav-deadline">
        <span className="topnav-dot" aria-hidden="true" />
        {/* On phones only "GW13" shows; the word "deadline" is hidden to save room. */}
        <span className="topnav-deadline-label">
          GW{gameweek}
          <span className="topnav-deadline-word"> deadline</span>
        </span>
        <b>{formatDeadline(deadline)}</b>
      </div>
      <BottomNav />
    </header>
  );
}
