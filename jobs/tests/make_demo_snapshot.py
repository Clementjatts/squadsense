"""Rebuilds web/data/sample-snapshot.json from the made-up sample data.

Run this from the jobs/ folder after changing the model, so the website's
demo mode shows the new numbers:

    python -m tests.make_demo_snapshot
"""

import os
import tempfile
from pathlib import Path

from squadsense.fpl_client import FplClient
from squadsense.sync import run
from tests.sample_data import TEAM_ID, FakeHttpClient, build_sample

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "web" / "data" / "sample-snapshot.json"


def main():
    # Make sure a real database setting can't sneak sample data into Supabase.
    os.environ.pop("DATABASE_URL", None)
    client = FplClient(min_seconds_between_requests=0, http_client=FakeHttpClient(build_sample()))
    with tempfile.TemporaryDirectory() as scratch_folder:
        run(TEAM_ID, False, scratch_folder, OUTPUT_PATH, client=client)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
