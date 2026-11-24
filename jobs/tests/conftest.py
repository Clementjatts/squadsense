"""Shared test setup.

Each sync sets FPL's published rules in squadsense.rules, so every test
starts and ends with the typed-in values; one test's rules never leak
into the next.
"""

import pytest

from squadsense import rules


@pytest.fixture(autouse=True)
def fresh_rules():
    """Typed-in rules before and after every test."""
    rules.use_defaults()
    yield
    rules.use_defaults()
