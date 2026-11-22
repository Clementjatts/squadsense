"""Small client for the public Fantasy Premier League API.

The API has no official docs and no published rate limit, so this client
is deliberately polite: one request per second, a few retries with a
growing wait, and a clear error when something still goes wrong.
"""

import time

import httpx

BASE_URL = "https://fantasy.premierleague.com/api/"

# FPL sometimes returns 503 while it updates (around deadlines and the
# nightly price change). These status codes are worth retrying.
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class FplApiError(Exception):
    """Raised when the FPL API gives us something we can't use."""


class FplClient:
    """Fetches JSON from the FPL API with rate limiting and retries."""

    def __init__(self, min_seconds_between_requests=1.0, max_attempts=4, http_client=None):
        self.min_seconds_between_requests = min_seconds_between_requests
        self.max_attempts = max_attempts
        # Tests pass in a fake client; real runs build one with a timeout.
        self.http_client = http_client or httpx.Client(
            base_url=BASE_URL,
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "SquadSense personal tool"},
        )
        self._last_request_time = 0.0

    def _wait_for_rate_limit(self):
        """Sleeps just long enough to keep requests at least one second apart."""
        elapsed = time.monotonic() - self._last_request_time
        if elapsed < self.min_seconds_between_requests:
            time.sleep(self.min_seconds_between_requests - elapsed)
        self._last_request_time = time.monotonic()

    def get(self, path):
        """Fetches one endpoint and returns the parsed JSON.

        Every FPL path needs a trailing slash, otherwise the API answers
        with an empty redirect, so we add it if it's missing. The slash
        goes before any "?page=..." part, not after it.
        """
        base, question_mark, query = path.partition("?")
        if not base.endswith("/"):
            base += "/"
        path = base + question_mark + query

        for attempt in range(1, self.max_attempts + 1):
            self._wait_for_rate_limit()
            try:
                response = self.http_client.get(path)
            except httpx.HTTPError as network_error:
                if attempt == self.max_attempts:
                    raise FplApiError(f"Network error on {path}: {network_error}") from network_error
                time.sleep(2 ** attempt)
                continue

            if response.status_code in RETRYABLE_STATUS_CODES and attempt < self.max_attempts:
                time.sleep(2 ** attempt)
                continue
            if response.status_code != 200:
                raise FplApiError(f"{path} returned HTTP {response.status_code}")

            try:
                return response.json()
            except ValueError as parse_error:
                # Unknown paths return an HTML 404 page, which lands here.
                raise FplApiError(f"{path} did not return JSON") from parse_error

        raise FplApiError(f"Gave up on {path} after {self.max_attempts} attempts")

    # Named helpers for the endpoints we use, so the rest of the code
    # never has to remember URL shapes.

    def bootstrap(self):
        return self.get("bootstrap-static/")

    def fixtures(self):
        return self.get("fixtures/")

    def element_summary(self, player_id):
        return self.get(f"element-summary/{player_id}/")

    def entry(self, team_id):
        return self.get(f"entry/{team_id}/")

    def entry_history(self, team_id):
        return self.get(f"entry/{team_id}/history/")

    def entry_transfers(self, team_id):
        return self.get(f"entry/{team_id}/transfers/")

    def entry_picks(self, team_id, gameweek):
        return self.get(f"entry/{team_id}/event/{gameweek}/picks/")

    def league_standings(self, league_id, page=1):
        """One page (up to 50 teams) of a classic league's table. Page 1 is the top."""
        if page == 1:
            return self.get(f"leagues-classic/{league_id}/standings/")
        return self.get(f"leagues-classic/{league_id}/standings/?page_standings={page}")

    def event_live(self, gameweek):
        return self.get(f"event/{gameweek}/live/")
