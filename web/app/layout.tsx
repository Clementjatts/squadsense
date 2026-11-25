// The app frame shared by every page: header on top, page below, sync note in the footer.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerPanelProvider } from "@/components/PlayerPanel";
import { TopNav } from "@/components/TopNav";
import { SettingUpTeam } from "@/components/SettingUpTeam";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TeamNotReadyError, getSnapshot, type LoadedSnapshot } from "@/lib/snapshot";

export const metadata: Metadata = {
  title: "SquadSense",
  description: "Personal FPL squad planner",
  // So the site can be added to a phone's Home Screen, which iPhones need for alerts.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SquadSense", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
  // Next.js 16 only writes the newer mobile-web-app-capable tag. Older
  // iPhone versions still look for Apple's own name before opening the
  // site as an app, so it is added by hand.
  other: { "apple-mobile-web-app-capable": "yes" },
};

// Phone screen settings. "cover" lets the dark page run under the iPhone
// notch and home bar in the Home Screen app; the CSS pads controls clear of
// them with env(safe-area-inset-*). The theme color matches the page
// background, so the status bar area blends in.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b14",
};

// Fonts load from Google in the browser. next/font would bundle them at
// build time instead, but that needs network access during the build.
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap";

// "13:19" in UK time, for the footer's last-sync note.
function formatSyncTime(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

// The page snapshot, or null when the signed-in team's first sync hasn't finished yet.
async function snapshotOrNotReady(): Promise<LoadedSnapshot | null> {
  try {
    return await getSnapshot();
  } catch (error) {
    if (error instanceof TeamNotReadyError) return null;
    throw error;
  }
}

// The <head> every page shares: the fonts, and optionally a self-refresh every few seconds.
function SharedHead({ refreshSeconds }: { refreshSeconds?: number }) {
  return (
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={FONT_URL} />
      {refreshSeconds && <meta httpEquiv="refresh" content={String(refreshSeconds)} />}
    </head>
  );
}

// How often the "Setting up your team" page reloads itself to see if the first sync is done.
const SETUP_REFRESH_SECONDS = 30;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-out visitors only see the account pages, so don't load any team data for them.
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) {
    return (
      <html lang="en">
        <SharedHead />
        <body>{children}</body>
      </html>
    );
  }
  const loaded = await snapshotOrNotReady();
  if (!loaded) {
    return (
      <html lang="en">
        <SharedHead refreshSeconds={SETUP_REFRESH_SECONDS} />
        <body>
          <SettingUpTeam />
        </body>
      </html>
    );
  }
  const { snapshot, isDemo } = loaded;
  return (
    <html lang="en">
      <SharedHead />
      <body>
        <PlayerPanelProvider>
          <TopNav gameweek={snapshot.gameweek} deadline={snapshot.deadline} />
          <div className="main">{children}</div>
          <footer className="site-footer">
            {isDemo ? "Demo mode: sample data, not your real team." : `Data synced ${formatSyncTime(snapshot.generatedAt)} UK time.`} Bank
            and selling prices are estimated from public data.
          </footer>
        </PlayerPanelProvider>
      </body>
    </html>
  );
}
