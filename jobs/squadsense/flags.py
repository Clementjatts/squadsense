"""Warnings about players: injuries, yellow-card bans and rotation.

Each check returns a short message for the Dashboard's "Watch out" list,
or None when there's nothing to say.
"""

# Premier League yellow-card bans for 2026/27 (FA player handbook):
# 5 yellows within a club's first 19 league games, 10 by its 32nd.
YELLOW_CARD_CUTOFFS = [(5, 19), (10, 32)]


def injury_flag(player):
    """Flags anyone FPL lists as doubtful, injured or suspended."""
    chance = player.get("chance_of_playing_next_round")
    if chance is None or chance == 100:
        return None
    news = player.get("news") or "No details yet"
    return f"{chance}% chance of playing. {news}"


def suspension_flag(player, club_matches_played):
    """Flags a player one booking away from a ban, if the cutoff hasn't passed."""
    yellows = player.get("yellow_cards", 0)
    for ban_threshold, last_counting_match in YELLOW_CARD_CUTOFFS:
        if yellows == ban_threshold - 1 and club_matches_played < last_counting_match:
            return f"On {yellows} yellows. One more before match {last_counting_match} means a ban."
    return None


def rotation_flag(history_rows):
    """Flags a fit player who has started fewer than 3 of the last 5."""
    recent = history_rows[-5:]
    if len(recent) < 5:
        return None
    full_games = sum(1 for row in recent if row["minutes"] >= 60)
    if full_games < 3:
        return f"Played 60+ minutes in only {full_games} of the last 5."
    return None


def club_matches_played(fixtures):
    """Counts finished league matches per club, for the yellow-card cutoffs."""
    played = {}
    for fixture in fixtures:
        if fixture.get("finished"):
            for team_id in (fixture["team_h"], fixture["team_a"]):
                played[team_id] = played.get(team_id, 0) + 1
    return played
