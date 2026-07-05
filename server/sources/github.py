"""GitHub source module — repos, releases, and user activity via the public REST API.

Follows the hackernews.py reference pattern: normalize(item), get_feed(), search(),
get_item(), all wrapped through cache.cached().

GitHub's unauthenticated rate limit is 60 req/hr/IP, so cache aggressively. To raise
the limit to 5000 req/hr, set a GITHUB_TOKEN in Settings (or env TUBCAL_GITHUB_TOKEN)
— read below for the extension point.
"""

from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

from .. import cache, config, httpc
from .fuzzy import fuzzy_filter

API = "https://api.github.com"
PAGE_SIZE = 30


def _auth_headers():
    """Return extra headers for authenticated requests.

    Extension point: if a GITHUB_TOKEN is configured in Settings (key 'github_token')
    or TUBCAL_GITHUB_TOKEN env var is set, pass it as a Bearer token to raise the
    rate limit from 60 → 5000 req/hr. No OAuth flow is built for this yet — the user
    creates a classic PAT at github.com/settings/tokens and pastes it here.
    """
    from .. import db
    token = db.get_setting("github_token") or None
    if not token:
        import os
        token = os.environ.get("TUBCAL_GITHUB_TOKEN") or None
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}


def _fetch(path):
    """GET a GitHub API path, returning the parsed JSON."""
    url = f"{API}{path}"
    return httpc.get(url, headers=_auth_headers()).json()


def _owner_avatar(owner):
    """Best-effort: extract owner avatar_url from an owner dict."""
    if isinstance(owner, dict):
        return owner.get("avatar_url")
    return None


def normalize(item):
    """Normalize a repo, release, or event dict into our standard feed-item shape.

    Maps GitHub concepts:
      score     → stargazers_count
      thumbnail → owner avatar_url
      author    → owner login
      source    → full_name (owner/repo)
    """
    if not item:
        return None
    # Determine type: could be a repo, a release, or a user event
    repo_name = item.get("full_name") or ""
    owner = item.get("owner") or {}
    avatar = _owner_avatar(owner)

    # Releases have a different shape
    if item.get("tag_name") and item.get("zipball_url") is not None:
        # It's a release
        repo_full = (item.get("url") or "").replace(f"{API}/repos/", "")
        if "/" in repo_full:
            repo_full = "/".join(repo_full.split("/")[:2])
        release_id = item.get('id') or item.get('node_id', '') or repo_full
        return {
            "id": f"github:release:{release_id}",
            "platform": "github",
            "title": item.get("name") or item.get("tag_name", ""),
            "url": item.get("html_url") or "",
            "thumbnail": avatar,
            "author": (owner or {}).get("login") or "",
            "source": repo_full or repo_name,
            "published_at": _parse_ts(item.get("published_at") or item.get("created_at")),
            "score": None,
            "comments_count": 0,
            "extra": {
                "type": "release",
                "repo": repo_full or repo_name,
                "tag": item.get("tag_name"),
                "prerelease": item.get("prerelease", False),
            },
        }

    # Public user events (PushEvent, CreateEvent, etc.)
    if item.get("type") and item.get("actor"):
        event_type = item["type"]
        repo_name = (item.get("repo") or {}).get("name") or ""
        actor = item.get("actor") or {}
        payload = item.get("payload") or {}
        title = _event_title(event_type, repo_name, payload)
        event_id = item.get('id') or repo_name or event_type
        return {
            "id": f"github:event:{event_id}",
            "platform": "github",
            "title": title,
            "url": f"https://github.com/{repo_name}",
            "thumbnail": actor.get("avatar_url"),
            "author": actor.get("login") or "",
            "source": repo_name,
            "published_at": _parse_ts(item.get("created_at")),
            "score": None,
            "comments_count": 0,
            "extra": {
                "type": "event",
                "event_type": event_type,
                "repo": repo_name,
            },
        }

    # Default: treat as a repository
    repo_id = item.get('id') or item.get('full_name', '')
    return {
        "id": f"github:repo:{repo_id}",
        "platform": "github",
        "title": item.get("name") or item.get("full_name", ""),
        "url": item.get("html_url") or f"https://github.com/{item.get('full_name', '')}",
        "thumbnail": avatar,
        "author": owner.get("login") or "",
        "source": item.get("full_name") or "",
        "published_at": _parse_ts(item.get("created_at") or item.get("pushed_at")),
        "score": item.get("stargazers_count"),
        "comments_count": item.get("open_issues_count") or 0,
        "extra": {
            "type": "repo",
            "description": (item.get("description") or "")[:300],
            "language": item.get("language"),
            "stars": item.get("stargazers_count"),
            "forks": item.get("forks_count"),
            "topics": item.get("topics") or [],
        },
    }


def _parse_ts(iso_str):
    """Parse an ISO-8601 timestamp to epoch seconds. Returns 0 on failure."""
    if not iso_str:
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(iso_str.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


def _event_title(event_type, repo_name, payload):
    """Build a human-readable title from a GitHub event."""
    if event_type == "PushEvent":
        commits = payload.get("commits", [])
        count = payload.get("size", 0)
        branch = (payload.get("ref") or "").replace("refs/heads/", "")
        if commits:
            msg = commits[0].get("message", "").split("\n")[0]
            return f"[{repo_name}] {msg} ({count} commit{'s' if count != 1 else ''})"
        return f"[{repo_name}] Pushed {count} commit{'s' if count != 1 else ''} to {branch}"
    elif event_type == "CreateEvent":
        ref_type = payload.get("ref_type", "")
        ref = payload.get("ref", "")
        return f"[{repo_name}] Created {ref_type} {ref}" if ref else f"[{repo_name}] Created"
    elif event_type == "IssuesEvent":
        action = payload.get("action", "")
        issue = payload.get("issue", {})
        return f"[{repo_name}] {action.title()} issue: {issue.get('title', '')}"
    elif event_type == "IssueCommentEvent":
        action = payload.get("action", "")
        issue = payload.get("issue", {})
        return f"[{repo_name}] Commented on issue: {issue.get('title', '')}"
    elif event_type == "PullRequestEvent":
        action = payload.get("action", "")
        pr = payload.get("pull_request", {})
        return f"[{repo_name}] {action.title()} PR: {pr.get('title', '')}"
    elif event_type == "WatchEvent":
        return f"[{repo_name}] Starred"
    elif event_type == "ForkEvent":
        forkee = payload.get("forkee", {})
        return f"[{repo_name}] Forked → {forkee.get('full_name', '')}"
    elif event_type == "ReleaseEvent":
        release = payload.get("release", {})
        return f"[{repo_name}] Released {release.get('tag_name', '')}"
    elif event_type == "DeleteEvent":
        ref_type = payload.get("ref_type", "")
        ref = payload.get("ref", "")
        return f"[{repo_name}] Deleted {ref_type} {ref}"
    return f"[{repo_name}] {event_type}"


def _fetch_repo_activity(source_id):
    """Fetch recent activity for a subscribed repo or user.

    `source_id` is "owner/repo" for a repo, or a plain username for a user's
    public activity. Returns a list of normalized items.
    """
    items = []

    if "/" in source_id:
        # It's a repo — fetch releases
        def fetch_releases():
            data = _fetch(f"/repos/{quote(source_id)}/releases?per_page=10")
            return [normalize(r) for r in data if r]

        try:
            releases_key = f"github:releases:{source_id.lower()}"
            releases_data, _ = cache.cached(releases_key, config.TTL_GITHUB_FEED, fetch_releases)
            items.extend(releases_data or [])
        except Exception:
            pass

        # Also fetch recent commits via events
        def fetch_events():
            data = _fetch(f"/repos/{quote(source_id)}/events?per_page=10")
            return [normalize(e) for e in data if e]

        try:
            events_key = f"github:events:{source_id.lower()}"
            events_data, _ = cache.cached(events_key, config.TTL_GITHUB_FEED, fetch_events)
            items.extend(events_data or [])
        except Exception:
            pass

    else:
        # It's a username — fetch public events
        def fetch_user_events():
            data = _fetch(f"/users/{quote(source_id)}/events/public?per_page=30")
            return [normalize(e) for e in data if e]

        try:
            user_key = f"github:user:events:{source_id.lower()}"
            user_data, _ = cache.cached(user_key, config.TTL_GITHUB_FEED, fetch_user_events)
            items.extend(user_data or [])
        except Exception:
            pass

    return [i for i in items if i]


def get_feed(list_name=None, page=0):
    """Activity from subscribed GitHub repos and users.

    Fetches activity from each subscription in parallel via ThreadPoolExecutor,
    then merges and sorts by published_at descending.
    """
    from .. import db as tubcal_db

    subs = tubcal_db.list_subscriptions("github")
    if not subs:
        return {"items": [], "has_more": False, "stale": False}

    source_ids = [s["source_id"] for s in subs]
    with ThreadPoolExecutor(max_workers=8) as ex:
        all_lists = list(ex.map(_fetch_repo_activity, source_ids))

    items = [item for lst in all_lists for item in lst]
    items.sort(key=lambda i: i.get("published_at") or 0, reverse=True)

    start = page * PAGE_SIZE
    chunk = items[start: start + PAGE_SIZE]
    return {"items": chunk, "has_more": start + PAGE_SIZE < len(items), "stale": False}


_PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}


def trending(period="daily", language=None, page=0):
    """Trending repos.

    GitHub doesn't expose a public unauthenticated trending endpoint (the
    github.com/trending page is HTML-only and not part of the REST API), so
    this uses the standard workaround every trending-repo tool relies on:
    search for repos *created* within the last N days, sorted by stars. It's
    an approximation of real trending (recency + popularity) rather than the
    "gained the most stars today" metric github.com's own page shows, but
    it's the closest thing achievable without scraping HTML.
    """
    from datetime import datetime, timedelta

    days = _PERIOD_DAYS.get(period, 1)
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    q = f"created:>{since}"
    if language:
        q += f" language:{quote(language)}"

    def fetch():
        path = f"/search/repositories?q={quote(q)}&sort=stars&order=desc&per_page={PAGE_SIZE}&page={page + 1}"
        return _fetch(path)

    key = f"github:trending:{period}:{language or 'all'}:{page}"
    data, stale = cache.cached(key, config.TTL_GITHUB_TRENDING, fetch)
    items = [n for n in (normalize(raw) for raw in (data.get("items") or [])) if n]
    return {"items": items, "has_more": len(items) == PAGE_SIZE, "stale": stale}


def search(query, page=0):
    """Search GitHub repositories.

    Uses /search/repositories?q=. Returns repos matching the query with
    scores representing star counts.
    """
    def fetch():
        path = f"/search/repositories?q={quote(query)}&sort=stars&order=desc&per_page={PAGE_SIZE}"
        return _fetch(path)

    data, stale = cache.cached(f"github:search:{query.lower()}:{page}", config.TTL_GITHUB_SEARCH, fetch)
    items = []
    for raw in (data.get("items") or []):
        n = normalize(raw)
        if n:
            items.append(n)

    # Fuzzy fallback: if the API returned few results, try matching against
    # the cached feed items (which may contain near-miss titles).
    if len(items) < 5:
        from .. import db as tubcal_db
        subs = tubcal_db.list_subscriptions("github")
        fuzzy_candidates = []
        for s in subs[:5]:
            cached_releases = cache.peek(f"github:releases:{s['source_id'].lower()}")
            if cached_releases:
                fuzzy_candidates.extend(cached_releases)
            cached_events = cache.peek(f"github:events:{s['source_id'].lower()}")
            if cached_events:
                fuzzy_candidates.extend(cached_events)
        if fuzzy_candidates:
            fuzzy_hits = fuzzy_filter(fuzzy_candidates, query, threshold=60, limit=10)
            seen_ids = {i["id"] for i in items}
            for hit_item, score in fuzzy_hits:
                if hit_item["id"] not in seen_ids:
                    seen_ids.add(hit_item["id"])
                    items.append(hit_item)

    return {"items": items, "stale": stale}


def get_readme(full_name):
    """Fetch a repo's README as pre-rendered HTML straight from GitHub's API
    (Accept: application/vnd.github.html), so no markdown renderer is needed
    client-side — just sanitize like any other remote HTML (Reddit/HN bodies).
    Returns None if there's no README or the fetch fails; a missing README
    shouldn't break the rest of the repo page.
    """
    def fetch():
        hdrs = _auth_headers()
        hdrs["Accept"] = "application/vnd.github.html"
        return httpc.get(f"{API}/repos/{quote(full_name)}/readme", headers=hdrs).text

    try:
        html, _ = cache.cached(f"github:readme:{full_name.lower()}", config.TTL_GITHUB_ITEM, fetch)
        return html
    except Exception:
        return None


def resolve(raw):
    """Resolve a user-typed "owner/repo" or plain username to a display record.

    Repos are validated against /repos/{owner}/{repo}; plain usernames are
    validated against /users/{username} (the old code always hit /repos/...,
    which 404s for a bare username since that's not a valid owner/repo path).
    Raises LookupError if GitHub returns 404, otherwise propagates other errors.
    """
    source_id = raw.strip().lstrip("@")
    for prefix in ("https://github.com/", "http://github.com/", "github.com/"):
        if source_id.lower().startswith(prefix):
            source_id = source_id[len(prefix):]
    source_id = source_id.strip("/")
    if not source_id:
        raise LookupError("invalid input")

    if "/" in source_id:
        owner, repo = source_id.split("/", 1)
        source_id = f"{owner}/{repo}"
        try:
            data = _fetch(f"/repos/{quote(source_id)}")
        except Exception as e:
            if "404" in str(e):
                raise LookupError(f"repo '{source_id}' not found")
            raise
        return {
            "source_id": source_id,
            "name": data.get("full_name") or source_id,
            "title": data.get("full_name") or source_id,
            "icon": _owner_avatar(data.get("owner")),
            "type": "repo",
        }
    else:
        try:
            data = _fetch(f"/users/{quote(source_id)}")
        except Exception as e:
            if "404" in str(e):
                raise LookupError(f"user '{source_id}' not found")
            raise
        login = data.get("login") or source_id
        return {
            "source_id": login,
            "name": login,
            "title": data.get("name") or login,
            "icon": data.get("avatar_url"),
            "type": "user",
        }


def get_item(full_name):
    """Fetch a single repo's detail by "owner/repo".

    Returns repo metadata (stars, forks, language, topics, description) plus
    the latest releases. For v1 this is a simple card with a link to github.com.
    """
    def fetch_repo():
        return _fetch(f"/repos/{quote(full_name)}")

    repo_raw, stale = cache.cached(f"github:repo:{full_name.lower()}", config.TTL_GITHUB_ITEM, fetch_repo)

    def fetch_releases():
        data = _fetch(f"/repos/{quote(full_name)}/releases?per_page=5")
        return [r for r in data if r]

    releases_raw, _ = cache.cached(
        f"github:releases:{full_name.lower()}",
        config.TTL_GITHUB_FEED,
        fetch_releases,
    )

    repo = normalize(repo_raw) if repo_raw else None
    releases = []
    for r in (releases_raw or []):
        n = normalize(r)
        if n:
            releases.append(n)

    return {
        "story": repo,
        "releases": releases,
        "readme_html": get_readme(full_name) if repo else None,
        "stale": stale,
    }