# Captain odds from history: design

Short design, approved by Clement on 24 November 2026 ("Correct it from history").

## Why

The Dashboard and the Chip Planner show each captain option's chance of
10+ points, from a 4,000-match simulation (`captaincy.py`). On 560 past
captain options it was too confident above 30% (options given over 60%
hauled about 30% of the time) and didn't beat a flat guess. The blank
chance was useful but a little low.

## Goals

- The shown haul and blank chances match how often those things really happened.
- Proven on seasons the correction wasn't fitted on.
- If the corrected haul chance still can't beat a flat guess, it's hidden.

## Non-goals

- Changing the simulation itself, the captain pick or any plan decision.

## Approaches

1. Correct the simulation's number with a fit on past results. Chosen.
2. Fix the simulation's causes (bonus guess, linked goals and minutes): slower, uncertain.
3. Hide the haul chance: quick, but loses the ceiling signal.

## The design

- The correction is Platt scaling: shown chance = 1 / (1 + e^-(a + b x logit(raw chance))).
  Two numbers per measure, so 560 past options are enough to fit it, and it
  keeps the order of the options. Raw chances are clamped to 0.5%-99.5% first.
- `captain_calibration.py` saves every past call with its season, fits the
  two numbers, and checks them season by season: fit on the other seasons,
  score the left-out one. The Brier scores of the raw chance, the corrected
  chance and a flat guess are printed for each.
- The fitted numbers live in `captaincy.py` (`HAUL_CALIBRATION`,
  `BLANK_CALIBRATION`) and `outcome_chances` returns corrected chances, so
  the Dashboard, the Chip Planner and the snapshot need no other change. A
  week with no match still gives 0% haul and 100% blank.
- If the corrected haul chance doesn't beat the flat guess on the left-out
  seasons, the website stops showing it; the blank chance stays either way.
- `docs/backtest-results.md` gets the before and after tables.

## Left to the builder

The fitting method (Newton steps in plain Python), file names for the saved calls.
