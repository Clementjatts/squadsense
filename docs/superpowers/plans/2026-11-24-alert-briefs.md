# Alert briefs and email templates: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-sync plan alerts with two briefs per gameweek, and send every alert as a branded HTML email with a plain-text copy.

**Architecture:** A new `briefs.py` builds the plan brief and the final call from the snapshot as labeled rows. A new `email_template.py` turns any alert into HTML and text. `alerts.py` keeps the sending, dedupe and push code, drops the plan-change and deadline alerts, and saves the plan brief so the final call can compare.

**Tech Stack:** Python 3 standard library (`html`, `zoneinfo`), httpx, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-alert-briefs-design.md`

## Global Constraints

- Plan brief window: deadline within 26 hours. Final call window: within 2.5 hours (`DEADLINE_WINDOW_HOURS`).
- A move is firm when `sameWeekShare >= 0.7` (`FIRM_SHARE`); a move with a `priceNote` is tagged "make now".
- Captain is a close call when the second option is within 0.5 xP (`CAPTAIN_CLOSE_XP`).
- Wildcard and Free Hit lines say "can't be undone".
- Times shown in UK time (`Europe/London`), as "Fri 27 Nov, 18:30 UK".
- Colors: navy `#0B1220`, card `#16213A`, line `#26324D`, text `#E8EDF7`, muted `#9AA6BF`, lime `#B7F34A`, orange `#FFA24C`.
- No em dashes in code, comments or copy. Every comment and docstring passes `checker.py`.
- Brief keys: `brief-{gw}` and `final-{gw}`; saved brief raw name `brief/{team_id}/{gw}`.

## Review Focus

- No solver plan (model-picked squad): briefs still go out with captain and chips only. Test in Task 1.
- Final call with no saved brief (alerts switched on late): no "Changed since" note, no crash. Test in Task 1.
- Player names with `&` or `<`: escaped in HTML. Test in Task 3.
- Missing `SITE_URL`: the button links to the bare path rather than breaking. Test in Task 3.
- Missing `team` in the snapshot (test fixtures): brief storage uses team id 0. Test in Task 2.

---

### Task 1: Brief content (`jobs/squadsense/briefs.py`)

**Interfaces:**
- Produces: `Row(label: str, value: str, tag: str | None)`; `plan_rows(snapshot) -> list[Row]`; `brief_summary(snapshot) -> dict` (`{"moves": [[out, in]], "captain": id, "chips": {chip: week}}`); `changes_since(saved: dict | None, snapshot) -> list[str]`; `uk_time(iso: str) -> str`.

- [ ] Test `test_plan_rows_mark_firm_and_close_calls`: a move with `sameWeekShare` 1.0 is tagged `FIRM`, 0.4 is `CLOSE CALL`, one with `priceNote` is `MAKE NOW`; captain 0.3 xP ahead of the next is `CLOSE CALL`; a Wildcard played this week says "can't be undone".
- [ ] Test `test_plan_rows_without_a_solver_plan`: `solverPlan: None` still gives captain and chip rows.
- [ ] Test `test_changes_since_names_the_old_captain`: saved captain 3, current 1 gives `["Captain was Palmer"]`; saved `None` gives `[]`.
- [ ] Run, watch them fail, implement, run `python -m pytest tests -k "plan_rows or changes_since"`, expect PASS.

### Task 2: Wire the briefs into alerts (`jobs/squadsense/alerts.py`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `Alert` gains `rows: list[Row]`, `note: str | None`, `after_send: callable | None`; `plan_brief_alert(snapshot, now, storage)`, `final_call_alert(snapshot, now, storage)`; `collect(snapshot, now, storage)`.

- [ ] Replace `test_deadline_alert_only_inside_the_window` and `test_plan_changes_alert_only_for_this_run` with `test_plan_brief_once_inside_26_hours` (sent at 20h, not at 30h, saves `brief/0/12`) and `test_final_call_lists_changes_since_the_brief`.
- [ ] Update `test_alerts_send_once_and_skip_old_news_on_the_first_run`: Saka is at risk but not sold, so no price alert; add a snapshot where the plan sells Saka and expect `Price drop likely tonight`.
- [ ] Remove `plan_change_alert`, `deadline_alert` and `plan_summary`. Push body stays one line (`alert.body`).
- [ ] Run `python -m pytest tests -k alert`, expect PASS.

### Task 3: Email template (`jobs/squadsense/email_template.py`)

**Interfaces:**
- Consumes: `Alert`, `Row`.
- Produces: `render_email(alert, site_url: str, sent_at: datetime) -> tuple[str, str]` (html, text). `send_email` posts `html`, `text` and `reply_to` (`ALERT_EMAIL_TO`).

- [ ] Test `test_email_escapes_names_and_links_the_page`: a row value `Smith & <Rowe>` appears escaped; button href is `https://x.test/plan`; text copy contains every row.
- [ ] Test `test_email_without_site_url_links_the_path`.
- [ ] Implement with table layout and inline styles; footer "Sent by SquadSense after the HH:MM UK sync."
- [ ] Render a sample to `jobs/.data/email-preview.html` and check it in the browser.

### Task 4: Docs and checks

- [ ] Update `alerts.py` docstring, `CLAUDE.md` (alerts bullet) and `README.md` (sender setup: Resend domain, Cloudflare records, `ALERT_EMAIL_FROM` secret).
- [ ] Run the full `python -m pytest`, `checker.py` on the new docs and changed Python files.
- [ ] Commit only after Clement says so.
