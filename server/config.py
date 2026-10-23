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
BRAIN_CHUNK_SECONDS = 45  # group transcript segments into ~this many seconds
BRAIN_SEARCH_TOPK = 12  # chunks returned by semantic search
# "Ask" runs a zoom pass: the model names the few excerpts worth reading more of,
# and those get re-read with their neighbouring chunks attached. 0 disables it
# (one LLM call per question instead of two).
BRAIN_ASK_EXPAND = int(os.environ.get("TUBCAL_BRAIN_ASK_EXPAND", "3"))
BRAIN_ASK_EXPAND_RADIUS = 2  # chunks either side of a chosen hit (~±90s)
TTL_BRAIN_DIGEST = 1800  # digest is expensive — cache it (SWR)

HOST = "127.0.0.1"
PORT = int(os.environ.get("TUBCAL_PORT", "5000"))

# How many cache entries stay in memory (the rest are one SQLite read away).
CACHE_MEM_MAX = int(os.environ.get("TUBCAL_CACHE_MEM_MAX", "1500"))
# How often a long-running server tidies itself (prune, vacuum), in seconds.
HOUSEKEEPING_EVERY = 86400

# The Anime room: AniList (GraphQL) + a local, AniList-id-mapped episode aggregator.
# The aggregator base URL can also be set in Settings (key: anime_source_url); the
# env/default here is the fallback. Provider is an adapter-specific hint (optional).
ANILIST_GQL = "https://graphql.anilist.co"
ANIME_SOURCE_URL = os.environ.get(
    "TUBCAL_ANIME_SOURCE", "http://127.0.0.1:3000"
).rstrip("/")
ANIME_PROVIDER = os.environ.get("TUBCAL_ANIME_PROVIDER", "")
# Auto-mark an episode watched on AniList once this % of it has played (0 = off).
ANIME_WATCHED_PERCENT = int(os.environ.get("TUBCAL_ANIME_WATCHED_PERCENT", "80"))

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
TTL_YT_SEARCH = 900  # InnerTube search pages (query results move slowly)
TTL_YT_SEARCH_EMPTY = 60  # a genuinely-empty page, kept brief in case it wasn't
# AniList (90 req/min cap → cache reads). Writes are user-initiated and not cached.
TTL_ANILIST_SEARCH = 600
TTL_ANILIST_BROWSE = 1800
TTL_ANILIST_MEDIA = 3600
TTL_ANILIST_STAFF = 21600  # a seiyuu's dossier changes far more slowly than a season
TTL_ANILIST_LIST = 60  # short so list/progress edits reflect quickly
# An empty browse/search/discover page is almost always a transient rate-limit,
# not the truth — cache it only briefly so a blank shelf self-heals on the next look.
TTL_ANILIST_EMPTY = 30
TTL_ANILIST_THREADS = 300
# The genre list + tag vocabulary is effectively static (AniList adds a tag every
# few months), so hold it for a day — it drives the discover picker.
TTL_ANILIST_GENRES = 86400
# The weekly airing timetable: slots move only when a broadcaster reschedules.
TTL_ANILIST_SCHEDULE = 1800
# A title's relation edges (sequels, side stories…) barely ever change; the
# sequel radar and watch-order guide fan out over them, so hold them half a day.
TTL_ANILIST_RELATIONS = 43200
TTL_ANILIST_PEOPLE = 21600  # character / studio pages, favourites-ranked shelves
TTL_ANILIST_REVIEWS = 600
TTL_ANILIST_SOCIAL = 300  # follower lists, the following feed
TTL_ANILIST_STATS = 600  # list-derived statistics (also dropped on any list edit)
TTL_ANIME_EPISODES = 600  # aggregator episode list
# AnimeThemes (the title page's opening): a show's themes change only when a new
# cour adds one, but an airing show's OP often lands days after its premiere.
TTL_ANIMETHEMES = 86400
TTL_ANIMETHEMES_EMPTY = 21600
# GitHub. The REST API allows 60 requests an hour without a token and 5,000 with
# one, so anything that costs an API call caches harder while no account is
# linked. github.com's own pages and Atom feeds (trending, commits, releases, the
# contribution calendar) don't count against that budget at all.
TTL_GITHUB_FEED = 600  # 10 min for subscribed repo/user activity (account linked)
TTL_GITHUB_FEED_ANON = 1800  # 30 min for the same with no token
TTL_GITHUB_ATOM = 600  # 10 min — a repo's commits.atom / releases.atom (free)
TTL_GITHUB_SEARCH = 300  # 5 min for search results
TTL_GITHUB_ITEM = 1800  # 30 min for a single repo detail
TTL_GITHUB_TRENDING = 1800  # 30 min — github.com/trending (or the search stand-in)
TTL_GITHUB_ME = 600  # 10 min — who the linked token belongs to, and its scopes
TTL_GITHUB_NOTIFS = 60  # 1 min — the inbox; GitHub asks clients to poll ≥60s apart
TTL_GITHUB_WORK = 180  # 3 min — your reviews/PRs/assignments (four search calls)
TTL_GITHUB_STARS = 600  # 10 min — your starred repos
TTL_GITHUB_TREE = 1800  # 30 min — a directory listing at a ref
TTL_GITHUB_FILE = 3600  # 1 h — a file at a ref (a sha'd ref never changes)
TTL_GITHUB_COMMITS = 600  # 10 min — a branch's commit list
TTL_GITHUB_THREAD = 300  # 5 min — an issue or pull request with its comments
TTL_GITHUB_USER = 3600  # 1 h — a person's or org's profile and repo list
TTL_GITHUB_CONTRIB = 10800  # 3 h — the contribution calendar
TTL_GITHUB_RELEASES = 1800  # 30 min — the release radar across what you follow
TTL_GITHUB_PARTICIPATION = 21600  # 6 h — a repo's 52-week commit counts
TTL_GITHUB_UPSTREAM = 600  # 10 min — has a local clone's upstream moved?
# The Workbench (No 09): per-language shelves. Podcast/blog feeds move slowly;
# the release stamp barely moves at all.
TTL_DEV_PODCASTS = 21600  # 6 h — a show posts weekly at best
TTL_DEV_UPDATES = 1800  # 30 min — blogs + GitHub releases merged
TTL_DEV_RELEASE = 21600  # 6 h — the "current stable" stamp

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
EDITION_WINDOW_H = 36  # clustering lookback over feed items (hours)
EDITION_SIM = 0.80  # cosine threshold for joining a story cluster. Short
# title+snippet vectors run hot under nomic — unrelated
# tech headlines often score 0.6+ — so this stays strict;
# same-story pairs land ~0.85+. (0.62 blobbed 40 items.)
EDITION_MAX_SYNTH = 6  # hard cap on LLM story writes per build (lede + columns)
EDITION_SNIPPET = 400  # chars of snippet fed to embedding / synthesis
# Lead story only: when its video is already transcribed in The Archive, the copy
# desk gets what was actually said instead of just a title + description.
EDITION_TRANSCRIPT_CHUNKS = 6  # transcript parts quoted into the lede prompt
EDITION_TRANSCRIPT_CHARS = 4000  # hard cap on that block (keeps 8B contexts sane)

# Minimum spacing between requests to a host (seconds).
# Reddit 429s aggressively on unauthenticated RSS — keep this generous;
# the TTL cache means we rarely hit them anyway.
#
# Invidious: opening a channel fires several calls at once (videos + playlists +
# search + live) and the recommendation shelf fans out more, all to one public
# instance — that burst is what trips a 429 and then blocks the host for ~30s,
# taking search and pagination down with it. A modest spacing turns the burst
# into a gentle stream so our pagination instance stays usable. Cache TTLs mean
# repeat opens don't re-hit these at all. Mirrors invidious._DEFAULT_INSTANCES.
HOST_INTERVALS = {
    "www.reddit.com": 3.0,
    "invidious.darkness.services": 1.0,
    "iv.melmac.space": 1.0,
    "invidious.privacydev.net": 1.0,
    "invidious.nerdvpn.de": 1.0,
    "yewtu.be": 1.0,
}

# Room ids — mirrors frontend/src/lib/rooms.js ROOM_IDS: the rooms Settings → Rooms
# can switch off, across the three channels (Social, Coding, Video). "/" is the
# channel chooser and The Anime is always on, so neither is listed here.
ROOM_IDS = [
    "edition",
    "youtube",
    "reddit",
    "hackernews",
    "archive",
    "editor",
    "github",
    "dev",
]

# The Composing Room (code editor): all filesystem access is hard-contained to
# this root — every path from the client resolves inside it or the request 400s.
EDITOR_ROOT = Path(
    os.environ.get("TUBCAL_EDITOR_ROOT", str(Path.home() / "Projects"))
).resolve()
EDITOR_MAX_FILE_BYTES = int(
    os.environ.get("TUBCAL_EDITOR_MAX_FILE_BYTES", str(4 * 1024 * 1024))
)
EDITOR_SEARCH_MAX_RESULTS = 500  # project-grep result cap
EDITOR_SUBPROC_TIMEOUT = 20  # seconds — rg / git shell-outs

