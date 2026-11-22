// The app frame shared by every page: header on top, page below, sync note in the footer.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PlayerPanelProvider } from "@/components/PlayerPanel";
import { TopNav } from "@/components/TopNav";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionIsValid } from "@/lib/session";
import { getSnapshot } from "@/lib/snapshot";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-out visitors only ever see the sign-in page, so don't load any team data for them.
  const signedIn = await sessionIsValid((await cookies()).get(SESSION_COOKIE)?.value);
  if (!signedIn) {
    return (
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="stylesheet" href={FONT_URL} />
        </head>
        <body>{children}</body>
      </html>
    );
  }
  const { snapshot, isDemo } = await getSnapshot();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href={FONT_URL} />
      </head>
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
