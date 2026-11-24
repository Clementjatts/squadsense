# "Done on FPL": implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clement marks a planned move as made on FPL; the next sync plans from the squad after it.

**Architecture:** Marks live in a Supabase table written by a website API route. The sync loads the coming week's marks, applies them to the public squad with `squad_state.apply_made_moves`, records them in the snapshot, and checks old marks against the real squad after the deadline.

**Tech Stack:** Python 3.12 + pytest, Next.js 16 route handlers, Supabase (Postgres 17).

**Spec:** `docs/superpowers/specs/2026-11-24-done-on-fpl-design.md`

## Global Constraints

- Table `made_moves(team_id int, gameweek int, player_out int, player_in int, price_in int, made_at timestamptz default now(), primary key (team_id, gameweek, player_out))`, RLS on, service role only.
- Applying a mark: bank += selling_prices[out] - price_in; purchase_prices[in] = selling_prices[in] = price_in; free_transfers = max(0, free - 1) (None stays None).
- A mark is skipped (with a warning) when out isn't in the squad or in already is.
- Snapshot field `madeMoves: {out, in, priceIn}[]`.
- Brief rows for marks: label "Transfer", value "X → Y", tag "DONE".
- Mismatch alert key `made-mismatch-{gw}-{out}`, title "A move you marked isn't in your FPL team".

## Review Focus

- A mark for a past gameweek: never applied.
- Two marks in one week: both applied, free transfers down by two (not below 0).
- Marking during a first week (unlimited transfers): free transfers stay None.
- Local runs without Supabase: no marks, nothing breaks.
- POST with a move not in the plan's first week: refused with 400.

---

### Task 1: Applying marks (`jobs/squadsense/squad_state.py`, `storage.py`, `sync.py`)

- [ ] Tests: one mark swaps players and adjusts bank, prices and free transfers; a mark that doesn't fit is skipped; two marks; unlimited week keeps None.
- [ ] Implement `apply_made_moves(state, moves) -> (state, applied, skipped)`; `load_made_moves(team_id, gameweek)` on both storages.
- [ ] Sync applies marks after `read_real_squad`; snapshot gets `madeMoves`.

### Task 2: After-deadline check and emails (`alerts.py`, `briefs.py`)

- [ ] Tests: `marked_move_mismatches(marks, real_ids)`; mismatch alert once; brief rows list DONE moves first.
- [ ] Sync saves mismatches for the week just started in the snapshot (`madeMoveMismatches`).

### Task 3: Database and website

- [ ] Migration: `made_moves` table plus `grant execute on function public.start_sync(boolean) to service_role`; same SQL in `db/schema.sql`.
- [ ] `/api/made-moves` (GET, POST, DELETE), POST/DELETE call `rpc("start_sync", {full_refresh: false})`.
- [ ] `MadeMoveButton` on the Plan page's first week and the Dashboard's This week card; `types.ts` fields.
- [ ] Check in the browser (local data), full pytest, `npm test`, `tsc`, checker, docs.
