# Member accounts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends and family sign up with an invite code, their FPL team ID and their own password, and each sees only their own team.

**Architecture:** Supabase Auth stores accounts; the site keeps its own signed cookie holding user, team, role and issue time. A `members` table drives the sync, which does the shared work once, runs the owner's team, then dispatches one GitHub run per member through `start_sync(full_refresh, team_id)`.

**Tech Stack:** Supabase (Auth, Postgres, pg_net, Vault), Python 3 + pytest, Next.js 16 + supabase-js.

**Spec:** `docs/superpowers/specs/2026-11-25-member-accounts-design.md`

## Global Constraints

- Owner team id 11304359. Every existing row (snapshots, made_moves, planner_drafts, watchlist, push_subscriptions, api_cache names) already belongs to it.
- Cookie: `squadsense_session` = `userId.teamId.role.issuedAtMs.expiresAtMs.signature` (HMAC-SHA256 with `SITE_SECRET` over everything before the signature); 30 days; once `issuedAt` is over 24 hours old the next request re-checks `members.active` and reissues.
- `INVITE_CODE` (Vercel setting), `MAX_MEMBERS` = 20, password at least 10 characters.
- No new secrets in the repository; the reset email is sent by a Supabase function using the Resend key already in Vault.
- Members never choose their team in the browser: every server read takes the team from the cookie.
- Comments, docs and commit messages pass `checker.py`; no em dashes; jobs/ is test-first.

## Review Focus

- One member requesting another team's data by any route: must be impossible.
- Clement's own sign-in during the switch: he can always get back in (owner fallback when Supabase isn't configured; sign-up open while he moves over).
- A member's first sync with no snapshot yet: "Setting up your team" page, not an error.
- Alert keys: one member's `brief-12` never blocks another's; Clement doesn't get his old alerts again.
- A member's run and the regular run at the same time: no shared-row corruption.

---

### Task 1: Database (main session, through the Supabase connector)

- [ ] `members(user_id uuid primary key references auth.users on delete cascade, team_id integer unique not null, name text not null, email text not null, role text not null default 'member' check (role in ('owner','member')), active boolean not null default true, emails boolean not null default true, created_at timestamptz not null default now())`, RLS on, service role only.
- [ ] `push_subscriptions.team_id integer not null default 11304359`.
- [ ] `alerts_sent`: prefix every existing key with `11304359:` (the new key format is `{team_id}:{key}`).
- [ ] `start_sync(full_refresh boolean default false, team_id integer default null)` sends input `team` when given.
- [ ] `send_reset_email(email text, link text)`: HTML in the alerts' layout through Resend, granted to the service role only.
- [ ] Same SQL added to `db/schema.sql` and `db/sync-schedule.sql`.

### Task 2: Sync (Python, `jobs/`)

**Produces:** `storage.load_members() -> [{"teamId", "name", "email", "role", "emails"}]` (active only, owner first; FileStorage reads `.data/members.json`, falling back to `FPL_TEAM_ID` as owner); `sync.run_shared(...)`, `sync.run_team(...)`; CLI `--team-id N` runs one team using the saved shared data.

- [ ] Tests: members load and fallback; a full run syncs the owner and dispatches one `start_sync(false, team)` per member (fake dispatcher); a one-team run doesn't download shared data; one team failing doesn't stop the others and the run exits non-zero at the end.
- [ ] Alerts: keys stored as `{team}:{key}`; email to the member's address when `emails` is on; push only to that team's subscriptions; "FPL changed its rules" owner only; first-run priming per team.
- [ ] `api_cache` clean-up on the nightly full run: price predictions after 30 days; `picks/`, `history/`, `strategy/`, `brief/`, `forecast/` rows for gameweeks more than 3 behind.
- [ ] Workflow: `team` input; `concurrency: sync-${{ inputs.team || 'all' }}`; passes `--team-id` when set.

### Task 3: Website accounts (`web/`)

**Produces:** `lib/session.ts`: `readSession(cookie) -> {userId, teamId, role, issuedAt} | null`, `createSession(...)`; `lib/currentTeam.ts`: `currentTeam() -> {teamId, role, name}` for server code (throws when signed out).

- [ ] Pages `/signup`, `/login`, `/forgot`, `/reset`; APIs `/api/signup` (invite code, cap, FPL lookup, `admin.createUser` with `email_confirm: true`, insert member, `start_sync(false, team)`), `/api/signup/team?id=` (team name and manager), `/api/login` (`signInWithPassword`; owner falls back to `SITE_PASSWORD` when Supabase isn't set up), `/api/forgot` (`admin.generateLink` recovery, then `send_reset_email`), `/api/reset` (`verifyOtp` with the token hash, then update password), `/api/me` (PATCH `emails`).
- [ ] `proxy.ts`: open paths for the account pages; daily re-check of `members.active`.
- [ ] Replace every `FPL_TEAM_ID` read with `currentTeam()`: `lib/snapshot.ts` (cache key per team), `lib/madeMoves.ts`, drafts, watchlist, push (save `team_id`), live, calendar (member token from user id; owner also accepts the old token), apply (owner and localhost only).
- [ ] "Setting up your team" state when a team has no snapshot yet; bell menu shows the name, an emails switch and sign out.
- [ ] Checks: session signing and expiry, the daily re-check rule, signup validation; `npm test`, `tsc`, build; browser check of sign-up, sign-in, reset and two accounts seeing different teams.

### Task 4: Switch-over (main session, with Clement)

- [ ] Clement sets `INVITE_CODE` in Vercel; deploy; he signs up with team 11304359; main session sets his `role` to owner.
- [ ] README: how to invite someone, remove someone, and the limits. CLAUDE.md updated.
