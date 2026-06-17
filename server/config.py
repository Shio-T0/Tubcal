import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "tubcal.db"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

HOST = "127.0.0.1"
PORT = int(os.environ.get("TUBCAL_PORT", "5000"))

BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
REDDIT_UA = "linux:tubcal:v0.1 (localhost personal aggregator)"

# Cache TTLs (seconds)
TTL_HN_LIST = 120
TTL_HN_ITEM = 1800
TTL_HN_COMMENTS = 300
TTL_REDDIT_LISTING = 300
TTL_REDDIT_COMMENTS = 300
TTL_YT_RSS = 600
TTL_YT_ACCOUNT_SUBS = 1800
TTL_YT_DISCOVER = 900  # Invidious trending/popular — the "random video" pool

# Invidious instances (override via TUBCAL_INVIDIOUS env, comma-separated).
# Used for trending/popular/search — things YouTube RSS can't provide.
INVIDIOUS_INSTANCES = [
    i.strip().rstrip("/")
    for i in os.environ.get("TUBCAL_INVIDIOUS", "").split(",")
    if i.strip()
] or None

# Minimum spacing between requests to a host (seconds).
# Reddit 429s aggressively on unauthenticated RSS — keep this generous;
# the TTL cache means we rarely hit them anyway.
HOST_INTERVALS = {
    "www.reddit.com": 3.0,
}
