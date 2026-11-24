# Scoring and squad rules from FPL: design

Short design, 24 November 2026.

## Why

FPL's points and squad rules are typed into `jobs/squadsense/rules.py`.
If FPL changes one mid-season (as it did when defensive contributions
arrived), the model keeps using the old value until someone notices.
FPL publishes these in `bootstrap-static`, which every sync already
downloads.

## Goals

- Each sync uses FPL's own values for the numbers FPL publishes.
- If FPL's value differs from the one typed in, Clement hears about it once.
- Past seasons (backtests) and test data, which don't carry these
  settings, keep working with the typed-in values.

## Non-goals

- The website's Planner rules (`web/lib/planning.ts`). They stay typed in;
  the alert says when they need updating.
- Numbers FPL doesn't publish: the 4-point hit, the defensive contribution
  thresholds, 1 point per 2 goals conceded and per 3 saves.

## What is read

| `rules.py` value | From `bootstrap-static` |
|---|---|
| `POINTS_FOR_60_MINUTES`, `POINTS_FOR_UNDER_60_MINUTES` | `game_config.scoring.long_play`, `short_play` |
| `POINTS_FOR_GOAL`, `POINTS_FOR_CLEAN_SHEET`, `POINTS_FOR_DEFENSIVE_CONTRIBUTION` | `goals_scored`, `clean_sheets`, `defensive_contribution` (by position) |
| `POINTS_FOR_ASSIST` | `assists` |
| `MAX_PER_CLUB`, `STARTING_BUDGET` | `game_settings.squad_team_limit`, `squad_total_spend` |
| `MAX_BANKED_FREE_TRANSFERS` | 1 + `game_settings.max_extra_free_transfers` |
| `SQUAD_SHAPE`, `MIN_STARTERS`, `MAX_STARTERS` | `element_types` `squad_select`, `squad_min_play`, `squad_max_play` |

`POINTS_FOR_DEFENSIVE_CONTRIBUTION` becomes per position, since FPL
publishes it that way (goalkeepers get 0).

## The design

- `rules.apply_fpl_settings(bootstrap)` reads the table above, sets the
  values in `rules.py`, and returns a list of differences from the
  typed-in defaults ("Points for a midfielder's goal: 5 now 6"). A missing
  section or field keeps the default for that value. `rules.use_defaults()`
  puts everything back (used by tests).
- `sync.run` calls it right after downloading `bootstrap-static`, before
  any model work. Differences are logged as warnings.
- `alerts.py` gets one more alert, "FPL changed its rules", listing the
  differences and saying the website's Planner rules may need updating.
  Its key is a hash of the list, so each change is sent once.
- Tests: values read from a made-up `game_config`; missing sections keep
  defaults; `use_defaults` restores; the alert fires once per change.

## Approaches

Changing values in `rules.py` at the start of a sync was chosen over
passing a scoring object through every model function: every caller
already reads `rules.X`, and a sync is one process for one season.
