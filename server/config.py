import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "tubcal.db"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

# The Archive (local second brain): scratch audio + local model endpoints.
BRAIN_DIR = DATA_DIR / "brain"
OLLAMA_URL = os.environ.get("TUBCAL_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
BRAIN_CHUNK_SECONDS = 45     # group transcript segments into ~this many seconds
BRAIN_SEARCH_TOPK = 12       # chunks returned by semantic search
TTL_BRAIN_DIGEST = 1800      # digest is expensive — cache it (SWR)

HOST = "127.0.0.1"
PORT = int(os.environ.get("TUBCAL_PORT", "5000"))

# The Anime room: AniList (GraphQL) + a local, AniList-id-mapped episode aggregator.
# The aggregator base URL can also be set in Settings (key: anime_source_url); the
# env/default here is the fallback. Provider is an adapter-specific hint (optional).
ANILIST_GQL = "https://graphql.anilist.co"
ANIME_SOURCE_URL = os.environ.get("TUBCAL_ANIME_SOURCE", "http://127.0.0.1:3000").rstrip("/")
ANIME_PROVIDER = os.environ.get("TUBCAL_ANIME_PROVIDER", "")

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
# AniList (90 req/min cap → cache reads). Writes are user-initiated and not cached.
TTL_ANILIST_SEARCH = 600
TTL_ANILIST_BROWSE = 1800
TTL_ANILIST_MEDIA = 3600
TTL_ANILIST_LIST = 60       # short so list/progress edits reflect quickly
TTL_ANILIST_THREADS = 300
TTL_ANIME_EPISODES = 600    # aggregator episode list
# GitHub (60 req/hr unauthenticated → cache aggressively)
TTL_GITHUB_FEED = 600       # 10 min for subscribed repo/user activity
TTL_GITHUB_SEARCH = 300     # 5 min for search results
TTL_GITHUB_ITEM = 1800      # 30 min for a single repo detail
TTL_GITHUB_TRENDING = 1800  # 30 min — trending is a search call, keep it cheap

# Invidious instances (override via TUBCAL_INVIDIOUS env, comma-separated).
# Used for trending/popular/search — things YouTube RSS can't provide.
INVIDIOUS_INSTANCES = [
    i.strip().rstrip("/")
    for i in os.environ.get("TUBCAL_INVIDIOUS", "").split(",")
    if i.strip()
] or None

# The Edition (No 00): the daily cross-platform paper. All embedding/clustering/
# synthesis happens in a background thread; the reader-facing API only ever reads
# a pre-built row, so none of these affect request latency.
EDITION_WINDOW_H = 36     # clustering lookback over feed items (hours)
EDITION_SIM = 0.80        # cosine threshold for joining a story cluster. Short
                          # title+snippet vectors run hot under nomic — unrelated
                          # tech headlines often score 0.6+ — so this stays strict;
                          # same-story pairs land ~0.85+. (0.62 blobbed 40 items.)
EDITION_MAX_SYNTH = 6     # hard cap on LLM story writes per build (lede + columns)
EDITION_SNIPPET = 400     # chars of snippet fed to embedding / synthesis

# Minimum spacing between requests to a host (seconds).
# Reddit 429s aggressively on unauthenticated RSS — keep this generous;
# the TTL cache means we rarely hit them anyway.
HOST_INTERVALS = {
    "www.reddit.com": 3.0,
}

# Room ids — mirrors frontend/src/lib/rooms.js ROOM_IDS.
ROOM_IDS = ["edition", "frontpage", "youtube", "reddit", "hackernews", "archive", "anime", "github"]