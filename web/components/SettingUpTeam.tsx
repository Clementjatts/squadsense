// Shown in place of every page while a new member's team has no snapshot
// yet (its first sync is still running). The page reloads itself (a
// refresh tag in the layout), so the dashboard appears once the sync is done.

import { AccountStage } from "./AccountStage";

// The "Setting up your team" card, with a sign-out button.
export function SettingUpTeam() {
  return (
    <AccountStage
      eyebrow="WELCOME TO SQUADSENSE"
      title="SETTING UP YOUR TEAM"
      text="Your team is being read for the first time. This takes about 5 minutes; this page refreshes itself."
    >
      <span className="signin-progress" aria-hidden="true" />
      <form method="post" action="/api/logout" className="signin-links">
        <button type="submit" className="signin-link-button">Sign out</button>
      </form>
    </AccountStage>
  );
}
