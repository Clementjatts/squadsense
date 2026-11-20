"""Made-up FPL API responses for tests and the website's demo mode.

The shapes match the real API, but every number is invented. Your squad
uses real player names so the screens look familiar; everyone else is
called something like "ARS MID 4". GW12 is the last finished week and
GW13 is next. GW16 has doubles for a few clubs and a blank for LIV.
"""

import random

TEAM_CODES = ["ARS", "MCI", "NEW", "CHE", "BHA", "AVL", "LIV", "MUN", "CRY", "BOU",
              "TOT", "FUL", "NFO", "BRE", "EVE", "WHU", "LEE", "WOL", "SUN", "BUR"]
CURRENT_WEEK = 12
LAST_SCHEDULED_WEEK = 19
TEAM_ID = 11304359

# (name, club, position, price in tenths, how attacking he is 0-1, extras)
NAMED_PLAYERS = [
    ("Raya", "ARS", 1, 55, 0.0, {}),
    ("Sánchez", "CHE", 1, 45, 0.0, {}),
    ("Gabriel", "ARS", 2, 60, 0.35, {}),
    ("Gvardiol", "MCI", 2, 60, 0.3, {}),
    ("Cash", "AVL", 2, 49, 0.25, {"chance_of_playing_next_round": 75, "news": "Knock"}),
    ("Mings", "AVL", 2, 44, 0.1, {}),
    ("Mykolenko", "EVE", 2, 44, 0.1, {}),
    ("Saka", "ARS", 3, 102, 0.8, {}),
    ("Palmer", "CHE", 3, 105, 0.8, {}),
    ("Fernandes", "MUN", 3, 90, 0.65, {}),
    ("McGinn", "AVL", 3, 55, 0.35, {}),
    ("Mbeumo", "MUN", 3, 80, 0.6, {}),
    ("Haaland", "MCI", 4, 146, 1.0, {}),
    ("Isak", "LIV", 4, 98, 0.75, {}),
    ("Calvert-Lewin", "LEE", 4, 59, 0.45, {"yellow_cards": 4}),
    ("Semenyo", "MCI", 3, 81, 0.9, {}),
    ("Wissa", "NEW", 4, 74, 0.8, {}),
    ("Mitoma", "BHA", 3, 66, 0.7, {}),
]
SQUAD_NAMES = [name for name, *_ in NAMED_PLAYERS[:15]]


def make_teams():
    """20 clubs, strongest first, shaped like the 2026/27 API.

    FPL now sends zeros for the attack and defence strengths and only
    fills in a 1-5 overall rating, so the sample does the same.
    """
    teams = []
    for index, code in enumerate(TEAM_CODES):
        overall = 5 - index // 5  # 5, 4, 3, 2 in blocks of five clubs
        teams.append({
            "id": index + 1, "name": code, "short_name": code,
            "strength_overall_home": overall, "strength_overall_away": overall,
            "strength_attack_home": 0, "strength_attack_away": 0,
            "strength_defence_home": 0, "strength_defence_away": 0,
        })
    return teams


def make_chips():
    """Every chip twice, GW1-19 and GW20-38, shaped like the 2026/27 API."""
    return [
        {"id": index + 1, "name": name, "start_event": start, "stop_event": stop}
        for index, (name, (start, stop)) in enumerate(
            (name, window) for window in [(1, 19), (20, 38)] for name in ["wildcard", "freehit", "bboost", "3xc"]
        )
    ]


def make_element_types():
    """The four positions, with the fields the code reads."""
    names = [("Goalkeeper", "GKP"), ("Defender", "DEF"), ("Midfielder", "MID"), ("Forward", "FWD")]
    return [
        {"id": index + 1, "singular_name": name, "singular_name_short": short}
        for index, (name, short) in enumerate(names)
    ]


def round_robin(team_ids):
    """Standard circle-method schedule: every team plays once per round."""
    ids = list(team_ids)
    rounds = []
    for _ in range(len(ids) - 1):
        rounds.append([(ids[i], ids[-1 - i]) for i in range(len(ids) // 2)])
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    return rounds


def make_fixtures():
    """Fixtures for GW1-19, with a few GW16 doubles and a LIV blank."""
    fixtures = []
    fixture_id = 1
    schedule = round_robin(range(1, 21))
    for week in range(1, LAST_SCHEDULED_WEEK + 1):
        for home, away in schedule[(week - 1) % len(schedule)]:
            if week == 16 and 7 in (home, away):
                continue  # LIV and their opponent blank in GW16
            fixtures.append(_fixture(fixture_id, week, home, away))
            fixture_id += 1
    # Extra GW16 matches create doubles for ARS, MCI, BHA and AVL.
    for home, away in [(1, 5), (2, 6)]:
        fixtures.append(_fixture(fixture_id, 16, home, away))
        fixture_id += 1
    return fixtures


def _fixture(fixture_id, week, home, away):
    return {
        "id": fixture_id, "event": week, "team_h": home, "team_a": away,
        "team_h_difficulty": 2 + (away - 1) // 7, "team_a_difficulty": 2 + (home - 1) // 7,
        "finished": week <= CURRENT_WEEK,
    }


def likelihood_band(percent):
    """The -5 to 5 band FPL attaches to a projected percentage, as seen in live data."""
    size = abs(percent)
    band = 5 if size >= 100 else 4 if size >= 95 else 3 if size >= 40 else 2 if size >= 20 else 1 if size > 0 else 0
    return band if percent >= 0 else -band


def price_predictor_fields(player):
    """FPL's 2026/27 price predictor fields, worked out from net transfers.

    Uses no random numbers, so adding these left every other sample value
    unchanged.
    """
    net = player["transfers_in_event"] - player["transfers_out_event"]
    progress = max(-120.0, min(120.0, net / 300))
    projections = [
        {"offset": offset, "projected_percent": f"{progress * (1 + 0.1 * (offset + 1)):.1f}",
         "likelihood": likelihood_band(progress * (1 + 0.1 * (offset + 1)))}
        for offset in range(3)
    ]
    return {
        "price_change_percent": f"{progress:.1f}", "price_change_hourly_rate": round(net / 24),
        "price_change_projections": projections, "price_change_locked_until": None,
        "price_change_calibrating": False, "cost_change_event": 0,
    }


def make_players(rng):
    """15 players per club: the named ones plus generic fillers."""
    teams_by_code = {code: index + 1 for index, code in enumerate(TEAM_CODES)}
    players = []
    named_slots = {}
    for name, club, position, price, attack, extras in NAMED_PLAYERS:
        named_slots.setdefault((club, position), []).append((name, price, attack, extras))

    player_id = 1
    for code in TEAM_CODES:
        for position, count in [(1, 2), (2, 5), (3, 5), (4, 3)]:
            named = named_slots.get((code, position), [])
            for slot in range(count):
                if slot < len(named):
                    name, price, attack, extras = named[slot]
                else:
                    name = f"{code} {['', 'GK', 'DEF', 'MID', 'FWD'][position]} {slot + 1}"
                    price = [0, 42, 42, 48, 52][position] + rng.randint(0, 25)
                    attack = {1: 0.0, 2: 0.15, 3: 0.4, 4: 0.55}[position] * rng.uniform(0.4, 1.3)
                    extras = {}
                player = {
                    "id": player_id, "web_name": name, "first_name": "", "second_name": name,
                    "penalties_order": 1 if position == 4 and slot == 0 else None, "team": teams_by_code[code], "element_type": position,
                    "now_cost": price, "selected_by_percent": f"{rng.uniform(0.1, 30):.1f}",
                    "chance_of_playing_next_round": None, "news": "", "yellow_cards": rng.randint(0, 3),
                    "transfers_in_event": rng.randint(0, 40000), "transfers_out_event": rng.randint(0, 40000),
                    "_attack": attack,
                }
                player.update(price_predictor_fields(player))
                player.update(extras)
                players.append(player)
                player_id += 1
    return players


def make_history(player, rng, fixture_lookup):
    """12 matches of invented stats, scaled by how attacking the player is.

    `fixture_lookup` maps (club, gameweek) to (fixture id, is home), so each
    row names its match the way the real API does.
    """
    rows = []
    is_regular = player["_attack"] > 0.3 or player["element_type"] == 1 or rng.random() < 0.6
    for week in range(1, CURRENT_WEEK + 1):
        minutes = 90 if is_regular and rng.random() < 0.85 else rng.choice([0, 0, 20, 65])
        xg = player["_attack"] * rng.uniform(0.1, 0.9) * minutes / 90
        xa = player["_attack"] * rng.uniform(0.05, 0.4) * minutes / 90
        fixture_id, is_home = fixture_lookup[(player["team"], week)]
        rows.append({
            "round": week, "fixture": fixture_id, "was_home": is_home, "minutes": minutes,
            "expected_goals": f"{xg:.2f}", "expected_assists": f"{xa:.2f}",
            "bonus": rng.choice([0, 0, 0, 1, 2, 3]) if minutes >= 60 else 0,
            "saves": rng.randint(1, 5) if player["element_type"] == 1 and minutes else 0,
            "defensive_contribution": rng.randint(4, 14) if player["element_type"] in (2, 3) and minutes else 0,
            "total_points": (2 if minutes >= 60 else 1 if minutes else 0) + round(xg * 5 + xa * 3),
            "value": player["now_cost"] - rng.choice([0, 0, 1, 2]) if week == 1 else player["now_cost"],
        })
    return rows


def make_events():
    events = []
    for week in range(1, 39):
        events.append({
            "id": week, "deadline_time": f"2026-{8 + (week + 2) // 4:02d}-{(week * 7) % 27 + 1:02d}T10:00:00Z",
            "is_current": week == CURRENT_WEEK, "is_next": week == CURRENT_WEEK + 1, "finished": week <= CURRENT_WEEK,
        })
    events[CURRENT_WEEK]["deadline_time"] = "2026-11-21T11:00:00Z"
    return events


def build_sample(seed=7):
    """Returns every fake API response, keyed by path."""
    rng = random.Random(seed)
    players = make_players(rng)
    fixtures = make_fixtures()
    responses = {
        "bootstrap-static/": {
            "events": make_events(), "teams": make_teams(), "elements": players, "element_types": make_element_types(),
            "chips": make_chips(),
        },
        "fixtures/": fixtures,
    }
    fixture_lookup = {}
    for fixture in fixtures:
        fixture_lookup[(fixture["team_h"], fixture["event"])] = (fixture["id"], True)
        fixture_lookup[(fixture["team_a"], fixture["event"])] = (fixture["id"], False)
    for player in players:
        responses[f"element-summary/{player['id']}/"] = {"history": make_history(player, rng, fixture_lookup)}

    by_name = {player["web_name"]: player["id"] for player in players}
    squad_ids = [by_name[name] for name in SQUAD_NAMES]
    responses[f"entry/{TEAM_ID}/"] = {
        "name": "Clement's XI", "player_first_name": "Clement", "player_last_name": "Adegbenro", "started_event": 1,
    }
    responses[f"entry/{TEAM_ID}/history/"] = {
        "current": [
            {"event": week, "bank": 14, "event_transfers": {5: 1, 8: 2, 11: 1}.get(week, 0)}
            for week in range(1, CURRENT_WEEK + 1)
        ],
        "chips": [{"name": "wildcard", "event": 7}],
    }
    responses[f"entry/{TEAM_ID}/transfers/"] = [
        {"event": 8, "element_in": by_name["Mbeumo"], "element_in_cost": 78, "element_out": by_name["Mitoma"]},
    ]
    responses[f"entry/{TEAM_ID}/event/{CURRENT_WEEK}/picks/"] = {
        "picks": [
            {"element": player_id, "is_captain": player_id == by_name["Haaland"],
             "is_vice_captain": player_id == by_name["Saka"]}
            for player_id in squad_ids
        ]
    }
    # Strip the helper field so responses look like the real API.
    for player in players:
        player.pop("_attack")
    return responses


class FakeHttpResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not JSON")
        return self._body


class FakeHttpClient:
    """Stands in for httpx.Client, answering from the sample responses."""

    def __init__(self, responses):
        self.responses = responses
        self.requested = []

    def get(self, path):
        self.requested.append(path)
        if path in self.responses:
            return FakeHttpResponse(200, self.responses[path])
        return FakeHttpResponse(404, None)
