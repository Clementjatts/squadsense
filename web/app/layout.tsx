// The app frame shared by every page: sidebar on the left, page on the right.

import type { Metadata } from "next";
import "./globals.css";
import { PlayerPanelProvider } from "@/components/PlayerPanel";
import { Sidebar } from "@/components/Sidebar";
import { getSnapshot } from "@/lib/snapshot";

export const metadata: Metadata = {
  title: "SquadSense",
  description: "Personal FPL squad planner",
};

// Fonts load from Google in the browser. next/font would bundle them at
// build time instead, but that needs network access during the build.
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { snapshot, isDemo } = await getSnapshot();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href={FONT_URL} />
      </head>
      <body>
        <PlayerPanelProvider>
          <div className="shell">
            <Sidebar teamName={snapshot.team.name} teamId={snapshot.team.id} syncedAt={snapshot.generatedAt} isDemo={isDemo} />
            <div className="main">{children}</div>
          </div>
        </PlayerPanelProvider>
      </body>
    </html>
  );
}
