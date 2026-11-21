# Backtest results

Run on 20 November 2026 with `python -m squadsense.backtest` (from `jobs/`). Past-season data comes from the community dataset at https://github.com/vaastav/Fantasy-Premier-League, which takes it from the official FPL API. Credit to Vaastav Anand.

## How it works

For every gameweek from GW4 on, the model only sees matches played before that week. It predicts each starter's points, and we compare with what he really scored. A "starter" here means he played 60+ minutes in a single match that week. Whether a player plays at all isn't tested, because old injury news isn't in the data.

| Measure | Meaning |
| --- | --- |
| top20 | Average real points of the model's 20 highest-xP starters each week |
| captain | Average real points of the model's top pick each week |
| slope | How much 1 point of predicted difference turned into real difference (1.0 is ideal) |
| mae | Average gap between predicted and real points |
| bias | Average predicted minus real, per position |

For scale, the average starter scores about 3.2 points. On the past seasons, luck alone can shift top20 by about 0.1 and captain by about 0.4.

## Before (model v1)

```
season    top20 captain slope   mae  bias (GK DEF MID FWD)   starts
2022-23    4.64    7.26  0.87  2.27  -0.11 -0.25 -0.29 -0.56  6334
2023-24    5.35    7.20  1.09  2.35  +0.32 +0.10 -0.05 -0.20  6769
2024-25    5.08    6.89  0.96  2.27  +0.14 -0.02 +0.05 -0.30  6976
all        5.03    7.12  0.97  2.30  +0.12 -0.05 -0.09 -0.35  20079
2026-27    4.81    6.43  0.71  2.35  -0.21 -0.32 +0.04 -0.58  1435
```

## After (model v2)

```
season    top20 captain slope   mae  bias (GK DEF MID FWD)   starts
2022-23    4.67    6.85  0.84  2.30  -0.10 -0.22 -0.20 -0.40  6334
2023-24    5.46    6.97  1.05  2.38  +0.33 +0.15 +0.09 -0.02  6769
2024-25    5.16    7.00  0.93  2.30  +0.15 +0.03 +0.18 -0.14  6976
all        5.10    6.94  0.93  2.33  +0.13 -0.01 +0.03 -0.18  20079
2026-27    4.84    6.43  0.70  2.38  -0.20 -0.27 +0.17 -0.40  1435
```

## What changed and why

Two corrections, both measured directly from the data rather than picked by a search:

- `ASSIST_FACTOR = 1.4`. FPL gave 1.41 assists per xA in 2023-24, 1.38 in 2024-25 and 1.39 in 2026-27 so far. 2022-23 was 2.12, the xA provider's first FPL season, so it was left out.
- Forward bonus prior from 0.4 to 0.6. Forwards averaged 0.50 to 0.72 bonus per start in every season, while other positions matched their old values.

Together they roughly halve the forward under-rating and nudge top20 up on both the past seasons and this one. The captain number fell on the past seasons but stayed the same this season; at one pick a week, that's within luck.

## What didn't change

A coordinate search over the prior strength, recency half-life, recent-points weight and per-position bonus found settings that raised top20 on the past seasons to 5.18, but they made this season worse (top20 4.61, captain 5.86). Every single change moved top20 by less than the 0.1 noise level, so the search was fitting luck. Those weights keep their original values.

The main finding: over 20,079 past starts the slope was 0.97, so the narrow spread of xP values is what real FPL points look like. It isn't a bug.

## Known limits

- The 1-5 club ratings in the old files are end-of-season values, so the starting guess for each club carries a little hindsight in early weeks. It fades as clubs play games and doesn't affect the 2026-27 check.
- This season's check covers GW4-10 only (1,435 starts), and it's the first season with defensive contribution points. Defenders are still under-rated by about 0.3 this season; rerun the backtest in a few weeks before changing anything for that.
- Clement's own past seasons can't be replayed: the FPL API only keeps season totals for past seasons, not weekly picks.

## Past-season starting point (21 November 2026)

Each player now starts from his position's typical numbers moved towards his own per-90 numbers from last season (FPL's `history_past`), using up to 900 minutes of last season against 450 minutes of the position average. Players with fewer than 270 minutes last season start from the position average, as before. Only this season can test it, since the downloaded past seasons don't include the season before each one.

```
setting (PAST_MINUTES_CAP)   top20  captain  slope   mae
0 (off, the old model)        4.84     6.43   0.70  2.38
450                           5.01     7.43   0.68  2.37
900 (kept)                    5.02     7.43   0.67  2.37
1800                          5.02     7.43   0.66  2.38
3400                          4.99     6.71   0.65  2.38
```

The captain pick gained a point a week and top20 rose by 0.18, larger than the 0.1 noise level, and every cap from 450 to 1800 gave about the same result. This is still only GW4-10 (1,435 starts), so recheck it in a few weeks.

## Chip timing (21 November 2026)

`python -m squadsense.chip_backtest` checks when to play Triple Captain and Bench Boost. Real squads from past seasons aren't available, so for each half of each downloaded season the model picks a squad at the start of the half and keeps it. Each method then plays each chip once, and the table shows the real points the chip added. "average week" is what a random week would earn; "hindsight" is the best week, which nothing can beat.

```
Triple Captain: real points the chip added
half                  planner best week only   first double  straight away   average week      hindsight
2022-23 4-19             17.0            6.0           17.0           17.0            8.2           23.0
2022-23 20-38            10.0           16.0            8.0            8.0            8.7           17.0
2023-24 4-19             10.0           10.0           10.0           20.0            5.1           20.0
2023-24 20-38             7.0            7.0            7.0            7.0            5.0           13.0
2024-25 4-19             13.0            9.0           13.0           13.0            9.9           21.0
2024-25 20-38            20.0           20.0           29.0            7.0            8.6           29.0
average                  12.8           11.3           14.0           12.0            7.6           20.5

Bench Boost: real points the chip added
half                  planner best week only   first double  straight away   average week      hindsight
2022-23 4-19             24.0           16.0           24.0           24.0            9.2           24.0
2022-23 20-38            18.0           16.0           18.0           18.0            7.8           18.0
2023-24 4-19              7.0            3.0           20.0            7.0            6.6           20.0
2023-24 20-38             3.0           16.0           16.0            3.0            9.3           22.0
2024-25 4-19             12.0            3.0           23.0           23.0            9.0           23.0
2024-25 20-38            23.0            2.0            5.0            6.0            5.7           23.0
average                  14.5            9.3           17.7           13.5            7.9           21.7
```

What it showed:

- The first version only played a chip in the single best forecast week ("best week only"). It waited too long: comparing one sure number this week with the highest of many rough forecasts for later weeks almost always makes a later week look better.
- Playing when this week is worth at least 90% of the best week left (`PLAY_SHARE` in `chips.py`) did better for both chips: Triple Captain 11.3 to 12.8, Bench Boost 9.3 to 14.5. 0.7 and 0.8 gave similar totals; 0.9 was kept as the smallest change.
- Both beat a random week, but neither beat "first double gameweek" (14.0 and 17.7). The Chips page says so, and a known double deserves extra weight.
- Six half-seasons is a small sample, and the kept squad is a stand-in for a real one, which changes every week. Treat these as direction, not precision.

## Ideas from GitHub (21 November 2026)

Each idea below was tested on the three downloaded seasons (2022-23 to 2024-25, "past") and on 2026-27 GW4-10 ("now"). Numbers are top20 and captain real points, as above.

### Scoring by real points ("buckets", from OpenFPL)

Predicted minus real points, split by what the player really scored:

```
            blank (0-2)  return (3-5)  big (6-9)  haul (10+)
past           +1.89        0.00         -3.26       -8.24
now            +2.23        +0.27        -3.15       -7.63
```

Like every points model, ours is drawn towards the middle: it can't know in advance which starter hauls, so hauls are under-predicted and blanks over-predicted. This is expected (the slope of 0.96 on past seasons says the spread is right on average), and it's the reason the captain haul chance exists. These numbers are the baseline future changes should be checked against.

### Goals conceded, rounded down per two goals

FPL takes one point per two goals conceded, rounded down; the model used goals/2. Counting it properly:

```
                  past top20  past captain  past DEF bias   now top20  now captain  now DEF bias
goals / 2            5.10         6.94          -0.01          5.02        7.43         -0.24
rounded down         5.07         7.12          +0.19          5.11        7.43         -0.04
```

Kept: it's FPL's actual rule, and it fixes most of this season's defender under-rating.

### Bookmaker odds (football-data.co.uk)

Expected goals from the average 1X2 and over/under 2.5 odds, blended with ours:

```
odds share   past top20  past captain   now top20  now captain
0               5.07         7.12          5.11        7.43
0.25            5.07         7.32          5.09        7.43
0.5             5.10         7.39          5.10        6.86
0.75            5.07         7.41          5.14        6.86
```

Kept at 0.5 (`MARKET_WEIGHT`). The past seasons are the bigger sample (about 100 weeks against 7), and there the captain pick rose by 0.27 points a week. This season's drop is one week's captain changing. Odds are only published for the next round, so they only affect the coming gameweek.

### Elo starting guesses

Our own Elo ratings (ClubElo's API was down) in place of FPL's 1-5 rating as each club's starting guess:

```
Elo scale     past top20  past captain   now top20  now captain
off (1-5)        5.07         7.12          5.11        7.43
0.001            5.04         7.01          5.00        6.71
0.0015           5.08         7.13          5.00        6.86
0.0025           5.10         7.17          5.21        6.86
```

Not used: no clear gain, and the captain pick got worse this season. The 1-5 rating already carries most of what Elo knows, and own xG takes over after a few games anyway.

### A second model (gradient boosting, from OpenFPL)

`python -m squadsense.challenger`: rolling 1, 3, 5, 10 and 38-appearance averages and our fixture expected goals, fitted by scikit-learn's gradient boosting. Each season is predicted by a model trained on the other seasons.

```
              top20  captain  slope   mae
2022-23        4.59    6.35   0.86   2.27
2023-24        5.14    9.17   0.98   2.38
2024-25        5.18    6.17   0.88   2.30
past average   4.97    7.23            
2026-27        5.04    4.86   0.75   2.31
```

Not used. Its average error is a little lower than ours, but it ranks players worse (top20 4.97 against 5.07 on past seasons, 5.04 against 5.11 now), and ranking is what picks transfers and captains.

### Predicting further ahead

The transfer plan looks five weeks out, so predictions made two and three weeks early were scored too:

```
weeks ahead   past top20  past captain   now top20  now captain
1                5.07         7.12          5.11        7.43
2                5.11         7.00          5.04        6.33
3                5.02         6.34          5.01        5.20
```

The top20 holds up well; the single captain pick gets less reliable further out, as you'd expect.

## The five-week plan and chip strategy (21 November 2026)

`python -m squadsense.plan_backtest` replays each half of the three downloaded seasons week by week. Four managers start from the same model-picked squad, decide each week with only earlier matches, and score the real points of the lineup the model would pick, with automatic subs and the vice-captain stepping in. Hits are taken off.

```
half            strategy      plan    single      hold
2022-23 4-19         931       918       890       892
2022-23 20-38       1279      1237      1138      1163
2023-24 4-19         964       935       857       730
2023-24 20-38       1289      1308      1171       987
2024-25 4-19         964      1005       940       948
2024-25 20-38       1138      1077      1100      1147
average           1094.2    1080.0    1016.0     977.8
```

strategy is the app's full strategy (transfers and chips), plan is the five-week transfer plan with no chips, single is the best single transfer each week, hold never transfers.

What it shows:

- Planning transfers five weeks ahead clearly beats one move at a time: 64 more real points per half on average (about 3.4 a gameweek), and 102 more than never transferring. It won 4 of 6 halves against single transfers.
- The chip strategy adds much less than expected: 14 points per half over the plan without chips, for four chips, and it lost 2 of the 6 halves. In every half it played all four chips within about the first eight weeks. The 90% "play now" rule came from testing one chip at a time and seems to make the plan spend chips too early when all four are decided together.
- Hits are sometimes overused: 52 and 56 points of hits in two halves. In 2024-25 GW20-38 holding beat every manager.
- Six halves with one stand-in squad is a small sample, so treat the chip and hit findings as a reason to retest, not as settled. The next things worth testing with this backtest are a stricter chip rule (a margin for every chip, not just the Wildcard) and a larger hit penalty. Each full run takes about an hour.
