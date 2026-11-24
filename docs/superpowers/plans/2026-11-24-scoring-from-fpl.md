# Scoring and squad rules from FPL: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each sync uses FPL's published scoring and squad rules, and alerts once when they differ from the typed-in defaults.

**Architecture:** `rules.apply_fpl_settings(bootstrap)` overwrites the module values and returns the differences; `sync.run` calls it and puts the differences in the snapshot as `ruleChanges`; `alerts.py` turns them into one alert.

**Tech Stack:** Python 3.12, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-scoring-from-fpl-design.md`

## Global Constraints

- Field mapping exactly as the spec's table; `MAX_BANKED_FREE_TRANSFERS = 1 + max_extra_free_transfers`.
- Position keys in FPL's scoring are `GKP`, `DEF`, `MID`, `FWD`.
- `POINTS_FOR_DEFENSIVE_CONTRIBUTION` becomes a dict by position (GK 0, others 2).
- Difference wording: `"<label>: <old> now <new>"`.
- Alert key `rules-<short hash of the joined differences>`, title `FPL changed its rules`, path `/`.

## Review Focus

- Bootstrap without `game_config` (past seasons, sample data): defaults kept, no differences.
- A field present but `None`: default kept for that value.
- Values leaking between tests: an autouse fixture calls `rules.use_defaults()`.
- First alerts run: rule changes are sent, not silenced like old injury news.
- Web snapshot type gains `ruleChanges?: string[]`.

---

### Task 1: `rules.apply_fpl_settings` and `use_defaults` (`jobs/squadsense/rules.py`, `jobs/tests/test_fpl_settings.py`)

- [ ] Tests: same values give no differences; a changed MID goal gives `["Points for a MID goal: 5 now 6"]` and sets `POINTS_FOR_GOAL[3] == 6`; missing `game_config` keeps defaults; `use_defaults` restores; banked transfers read as 1 + extra.
- [ ] Watch them fail, implement, watch them pass.
- [ ] Switch `model.py` and `captaincy.py` to `POINTS_FOR_DEFENSIVE_CONTRIBUTION[position]`.

### Task 2: Sync, snapshot and alert

- [ ] Test: `alerts.rule_change_alert` sends once per list and nothing for an empty list.
- [ ] `sync.run` calls `apply_fpl_settings` after loading bootstrap, logs each difference, adds `ruleChanges` to the snapshot; `types.ts` gains the field.
- [ ] Full pytest, `npx tsc`, checker, docs (CLAUDE.md "Known gaps" line about hardcoded scoring).
