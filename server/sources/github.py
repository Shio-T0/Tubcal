"""GitHub — repos, people, activity, releases and (with a linked account) your own
inbox, work and stars.

Follows the hackernews.py reference pattern (normalize, get_feed, search,
get_item, all cached), but GitHub has two quite different front doors:

* The REST API (api.github.com). 60 requests an hour per IP without a token,
  5,000 with one, counted per *bucket* (core, search, graphql, code_search).
  `_api` keeps those books from the response headers (`budget()`), fails fast
  while a bucket is empty, and revalidates cached GETs with their ETag — a 304
  costs nothing when a token is sent.
* github.com itself: the trending pages, the contribution calendar and the
  Atom feeds of a repo's commits and releases. None of it counts against the
  API budget, so whatever can come from there does (the activity graph's
  commits and the release radar are Atom; only issues/PRs cost a call).

GitHub trimmed its Events API payloads in 2025: a PushEvent no longer lists its
commits and a PullRequestEvent no longer carries the PR's title. That's why a
followed *repo*'s activity is built from commits.atom + releases.atom + one
issues call, and only a followed *person* (who has no Atom equivalent worth
parsing) still goes through events.

The account: a token in the `oauth` table under provider "github" (pasted, or
taken from the GitHub CLI's own sign-in with `gh auth token`), or the legacy
`github_token` setting / TUBCAL_GITHUB_TOKEN env var. `account()` says who it
belongs to and what its scopes allow (`capabilities`). Every call is made
cookie-free (`anonymous=True`): the token travels in its own header.
"""

import hashlib
import html as htmllib
import os
import re
import shutil
import subprocess
import threading
import time
from base64 import b64decode
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

import requests

from .. import cache, config, httpc
from .fuzzy import fuzzy_filter

API = "https://api.github.com"
WEB = "https://github.com"
PAGE_SIZE = 30
FEED_PAGE = 80  # the activity graph groups by day and repo, so it wants more per page
FEED_DAYS = 14  # how far back a followed repo's commits and issues reach
_JSON = "application/vnd.github+json"
_FULL = "application/vnd.github.full+json"  # adds body_html beside body
_HTML = "application/vnd.github.html"


class GitHubError(Exception):
    """A GitHub failure worth telling the user about. `kind` is one of
    rate_limit, auth, scope, not_found, unlinked, invalid, upstream."""

    def __init__(self, message, status=502, kind="upstream"):
        super().__init__(message)
        self.status = status
        self.kind = kind


# ── the token ────────────────────────────────────────────────────────────────

def _token():
    """The linked account's token, if any: the oauth row first, then the legacy
    setting, then the environment."""
    from .. import db
    row = db.get_oauth("github")
    if row and row.get("access_token"):
        return row["access_token"]
    return db.get_setting("github_token") or os.environ.get("TUBCAL_GITHUB_TOKEN") or None


def _auth_headers():
    tok = _token()
    return {"Authorization": f"Bearer {tok}"} if tok else {}


def _token_tag(tok):
    return hashlib.sha1(tok.encode()).hexdigest()[:12]


# ── the budget ───────────────────────────────────────────────────────────────

_budget = {}  # bucket -> {limit, remaining, reset, used, at}
_empty_until = {}  # bucket -> epoch second it refills
_budget_lock = threading.Lock()


def _bucket(path):
    if path.startswith("/search/code"):
        return "code_search"
    if path.startswith("/search/"):
        return "search"
    if path.startswith("/graphql"):
        return "graphql"
    return "core"


def note_budget(headers, bucket_hint="core"):
    """Record a response's X-RateLimit-* headers. Returns the bucket name."""
    bucket = headers.get("X-RateLimit-Resource") or bucket_hint
    try:
        entry = {
            "limit": int(headers["X-RateLimit-Limit"]),
            "remaining": int(headers["X-RateLimit-Remaining"]),
            "reset": int(headers["X-RateLimit-Reset"]),
            "used": int(headers.get("X-RateLimit-Used") or 0),
            "at": int(time.time()),
        }
    except (KeyError, TypeError, ValueError):
        return bucket
    with _budget_lock:
        _budget[bucket] = entry
        if entry["remaining"] <= 0:
            _empty_until[bucket] = entry["reset"]
        else:
            _empty_until.pop(bucket, None)
    return bucket


def _clock(epoch):
    return datetime.fromtimestamp(epoch).strftime("%H:%M")


def _limit_error(bucket, reset, authed):
    when = _clock(reset) if reset else "soon"
    what = {"search": "search limit", "code_search": "code search limit"}.get(bucket, "API limit")
    tail = "" if authed else " Link an account in Settings → Accounts to raise it to 5,000 an hour."
    return GitHubError(f"GitHub's {what} is used up until {when}.{tail}", 429, "rate_limit")


def budget(refresh=False):
    """What's left in each bucket. `/rate_limit` itself is free, so a stale or
    empty record is refreshed from it."""
    with _budget_lock:
        known = {k: dict(v) for k, v in _budget.items()}
    core = known.get("core")
    if refresh or not core or time.time() - core["at"] > 300 or time.time() > core["reset"]:
        try:
            resp = _api("GET", "/rate_limit", bucket_check=False)
            res = (resp.json() or {}).get("resources") or {}
            now = int(time.time())
            with _budget_lock:
                for name, v in res.items():
                    if isinstance(v, dict) and "limit" in v:
                        _budget[name] = {"limit": v["limit"], "remaining": v["remaining"],
                                         "reset": v["reset"], "used": v.get("used", 0), "at": now}
                known = {k: dict(v) for k, v in _budget.items()}
        except Exception:
            pass
    out = {k: known[k] for k in ("core", "search", "graphql", "code_search") if k in known}
    return {"authenticated": bool(_token()), "buckets": out}


# ── the transport ────────────────────────────────────────────────────────────

def _api(method, path, *, params=None, json=None, accept=_JSON, headers=None, token=True,
         bucket_check=True, timeout=15):
    """One REST call. `token=True` sends the linked token if there is one; a
    string sends that token; False sends none. Raises GitHubError."""
    tok = _token() if token is True else (token or None)
    hdrs = {"Accept": accept, "X-GitHub-Api-Version": "2022-11-28"}
    if tok:
        hdrs["Authorization"] = f"Bearer {tok}"
    hdrs.update(headers or {})
    bucket = _bucket(path)
    if bucket_check:
        until = _empty_until.get(bucket)
        if until and time.time() < until:
            raise _limit_error(bucket, until, bool(tok))
    url = path if path.startswith("http") else f"{API}{path}"
    try:
        if method == "GET":
            resp = httpc.get(url, headers=hdrs, params=params, timeout=timeout,
                             anonymous=True, host_limits=False)
        else:
            resp = httpc.request(method, url, headers=hdrs, params=params, json=json,
                                 timeout=timeout, anonymous=True)
    except requests.HTTPError as e:
        raise _map_error(e.response, bucket, bool(tok)) from None
    except requests.RequestException as e:
        raise GitHubError(f"Couldn't reach GitHub: {e.__class__.__name__}", 502, "upstream") from None
    note_budget(resp.headers, bucket)
    return resp


def _message(resp):
    try:
        body = resp.json()
    except ValueError:
        return ""
    msg = body.get("message") or ""
    errs = body.get("errors") or []
    if errs and isinstance(errs[0], dict) and errs[0].get("message"):
        msg = f"{msg}: {errs[0]['message']}" if msg else errs[0]["message"]
    return msg


def _map_error(resp, bucket, authed):
    status = resp.status_code if resp is not None else 502
    headers = resp.headers if resp is not None else {}
    msg = _message(resp) if resp is not None else ""
    if resp is not None:
        note_budget(headers, bucket)
    if status in (403, 429) and (headers.get("X-RateLimit-Remaining") == "0" or "rate limit" in msg.lower()):
        reset = int(headers.get("X-RateLimit-Reset") or 0)
        if not reset and headers.get("Retry-After"):
            reset = int(time.time()) + int(headers["Retry-After"])
        with _budget_lock:
            _empty_until[bucket] = reset or int(time.time()) + 60
        return _limit_error(bucket, reset, authed)
    if status == 401:
        if authed:
            return GitHubError("GitHub refused the linked token. Link the account again in Settings → Accounts.", 401, "auth")
        return GitHubError("This needs a linked GitHub account.", 401, "unlinked")
    if status == 403:
        low = msg.lower()
        if "not accessible" in low or "scope" in low or "permission" in low:
            return GitHubError(f"The linked token isn't allowed to do this ({msg}).", 403, "scope")
        return GitHubError(msg or "GitHub said no (403).", 403, "scope")
    if status == 404:
        return GitHubError("Not found on GitHub.", 404, "not_found")
    if status == 422:
        return GitHubError(msg or "GitHub couldn't process that.", 422, "invalid")
    if status == 451:
        return GitHubError("This repository is unavailable for legal reasons.", 451, "not_found")
    return GitHubError(f"GitHub answered {status}{': ' + msg if msg else ''}", 502, "upstream")


def _fetch(path):
    """GET an API path, returning the parsed JSON (the Workbench uses this)."""
    return _api("GET", path).json()


def _cached(key, ttl, path, *, params=None, accept=_JSON, shape=None, raw=False):
    """A cached GET that revalidates with the stored ETag once the TTL is up.
    Returns (data, next_page_exists, stale)."""

    def fetch():
        prior = cache.peek(key)
        extra = {}
        if isinstance(prior, dict) and prior.get("etag"):
            extra["If-None-Match"] = prior["etag"]
        resp = _api("GET", path, params=params, accept=accept, headers=extra)
        if resp.status_code == 304 and isinstance(prior, dict) and "data" in prior:
            return prior
        if resp.status_code in (202, 204):  # stats being computed / empty
            body = None
        else:
            body = resp.text if raw else resp.json()
        return {
            "etag": resp.headers.get("ETag"),
            "next": bool(resp.links.get("next")),
            "data": shape(body) if shape else body,
        }

    payload, stale = cache.cached(key, ttl, fetch)
    return payload.get("data"), bool(payload.get("next")), stale


def _web(path, ttl, key, parse):
    """A cached github.com page or feed (not the API, so no budget)."""

    def fetch():
        resp = httpc.get(f"{WEB}{path}", headers={"Accept-Language": "en-US,en;q=0.8"},
                         anonymous=True, timeout=15)
        return parse(resp.text)

    data, stale = cache.cached(key, ttl, fetch)
    return data, stale


def _feed_ttl():
    return config.TTL_GITHUB_FEED if _token() else config.TTL_GITHUB_FEED_ANON


# ── small helpers ────────────────────────────────────────────────────────────

_NAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


def check_owner(owner):
    if not owner or not _NAME.match(owner):
        raise GitHubError("That isn't a GitHub user or organisation name.", 400, "invalid")
    return owner


def check_repo(owner, name):
    check_owner(owner)
    if not name or not _REPO.match(name) or name in (".", ".."):
        raise GitHubError("That isn't a repository name.", 400, "invalid")
    return f"{owner}/{name}"


def _split(full):
    owner, _, name = (full or "").partition("/")
    return check_repo(owner, name.split("/")[0])


def _ts(iso_str):
    """Parse an ISO-8601 timestamp to epoch seconds. Returns 0 on failure."""
    if not iso_str:
        return 0
    try:
        return int(datetime.fromisoformat(str(iso_str).replace("Z", "+00:00").replace(" UTC", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


_parse_ts = _ts  # older name, kept for anything importing it


def _repo_from_api_url(url):
    m = re.match(r"https://api\.github\.com/repos/([^/]+/[^/]+)", url or "")
    return m.group(1) if m else ""


def _user(u):
    u = u or {}
    return {"login": u.get("login") or "", "avatar": u.get("avatar_url"), "type": u.get("type")} if u else None


def _excerpt(text, n=240):
    text = re.sub(r"<!--[\s\S]*?-->", "", text or "")
    text = re.sub(r"```[\s\S]*?```", " [code] ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _labels(raw):
    out = []
    for lb in raw or []:
        if isinstance(lb, dict) and lb.get("name"):
            out.append({"name": lb["name"], "color": (lb.get("color") or "").lower() or None})
    return out


# ── normalizers ──────────────────────────────────────────────────────────────

def normalize_repo(r):
    full = r.get("full_name") or ""
    owner = r.get("owner") or {}
    lic = r.get("license") or {}
    spdx = lic.get("spdx_id")
    return {
        "id": f"github:repo:{full.lower()}" if full else f"github:repo:{r.get('id')}",
        "platform": "github",
        "title": r.get("name") or full,
        "url": r.get("html_url") or f"{WEB}/{full}",
        "thumbnail": owner.get("avatar_url"),
        "author": owner.get("login") or "",
        "source": full,
        "published_at": _ts(r.get("created_at") or r.get("pushed_at")),
        "score": r.get("stargazers_count"),
        "comments_count": r.get("open_issues_count") or 0,
        "extra": {
            "type": "repo",
            "description": (r.get("description") or "")[:300],
            "language": r.get("language"),
            "stars": r.get("stargazers_count"),
            "forks": r.get("forks_count"),
            "topics": r.get("topics") or [],
            "watchers": r.get("subscribers_count"),
            "open_issues": r.get("open_issues_count"),
            "license": spdx if spdx and spdx != "NOASSERTION" else (lic.get("name") or None),
            "default_branch": r.get("default_branch"),
            "pushed_at": _ts(r.get("pushed_at")),
            "created_at": _ts(r.get("created_at")),
            "archived": bool(r.get("archived")),
            "fork": bool(r.get("fork")),
            "private": bool(r.get("private")),
            "homepage": r.get("homepage") or None,
            "size": r.get("size"),
            "owner_type": owner.get("type"),
            "parent": (r.get("parent") or {}).get("full_name"),
            "has_issues": r.get("has_issues", True),
            "has_discussions": bool(r.get("has_discussions")),
        },
    }


def normalize_release(rel, repo=None):
    repo_full = repo or _repo_from_api_url(rel.get("url"))
    tag = rel.get("tag_name") or ""
    author = rel.get("author") or {}
    if repo_full and tag:
        rid = f"{repo_full.lower()}@{tag}"
    else:
        rid = rel.get("id") or rel.get("node_id") or repo_full
    assets = [
        {"name": a.get("name"), "size": a.get("size"), "downloads": a.get("download_count"),
         "url": a.get("browser_download_url")}
        for a in rel.get("assets") or [] if a.get("name")
    ]
    return {
        "id": f"github:release:{rid}",
        "platform": "github",
        "title": rel.get("name") or tag,
        "url": rel.get("html_url") or (f"{WEB}/{repo_full}/releases/tag/{quote(tag)}" if repo_full else ""),
        "thumbnail": author.get("avatar_url"),
        "author": author.get("login") or "",
        "source": repo_full,
        "published_at": _ts(rel.get("published_at") or rel.get("created_at")),
        "score": None,
        "comments_count": 0,
        "extra": {
            "type": "release",
            "repo": repo_full,
            "tag": tag,
            "prerelease": bool(rel.get("prerelease")),
            "draft": bool(rel.get("draft")),
            "notes_html": rel.get("body_html"),
            "assets": assets,
            "text": rel.get("name") or tag,
        },
    }


def normalize_issue(i, repo=None):
    """An issue or a pull request, from the issues, pulls or search endpoints."""
    repo_full = repo or _repo_from_api_url(i.get("repository_url") or i.get("url"))
    pr = i.get("pull_request")
    is_pull = pr is not None or "/pull/" in (i.get("html_url") or "") or "head" in i
    kind = "pull" if is_pull else "issue"
    merged_at = (pr or {}).get("merged_at") if isinstance(pr, dict) else None
    merged_at = merged_at or i.get("merged_at")
    user = i.get("user") or {}
    number = i.get("number")
    state = i.get("state") or "open"
    if merged_at:
        state = "merged"
    created, closed, updated = _ts(i.get("created_at")), _ts(i.get("closed_at")), _ts(i.get("updated_at"))
    merged = _ts(merged_at)
    # What last happened to it, for the activity graph.
    action, at = "opened", created
    if merged and merged >= at:
        action, at = "merged", merged
    elif closed and closed >= at:
        action, at = "closed", closed
    if updated - at > 120 and (i.get("comments") or 0) > 0:
        action, at = "discussed", updated
    return {
        "id": f"github:{kind}:{repo_full.lower()}#{number}",
        "platform": "github",
        "title": i.get("title") or "",
        "url": i.get("html_url") or f"{WEB}/{repo_full}/{'pull' if is_pull else 'issues'}/{number}",
        "thumbnail": user.get("avatar_url"),
        "author": user.get("login") or "",
        "source": repo_full,
        "published_at": at or created,
        "score": None,
        "comments_count": i.get("comments") or 0,
        "extra": {
            "type": kind,
            "kind": kind,
            "repo": repo_full,
            "number": number,
            "state": state,
            "state_reason": i.get("state_reason"),
            "draft": bool(i.get("draft")),
            "labels": _labels(i.get("labels")),
            "comments": i.get("comments") or 0,
            "created_at": created,
            "updated_at": updated,
            "closed_at": closed,
            "merged_at": merged,
            "action": action,
            "assignees": [_user(a) for a in i.get("assignees") or [] if a],
            "milestone": (i.get("milestone") or {}).get("title"),
            "reactions": (i.get("reactions") or {}).get("total_count") or 0,
            "association": i.get("author_association"),
            "head": ((i.get("head") or {}).get("ref")) if isinstance(i.get("head"), dict) else None,
            "base": ((i.get("base") or {}).get("ref")) if isinstance(i.get("base"), dict) else None,
            "text": i.get("title") or "",
        },
    }


def normalize_commit(c, repo):
    commit = c.get("commit") or {}
    msg = commit.get("message") or ""
    head, _, body = msg.partition("\n")
    author = c.get("author") or {}
    who = commit.get("author") or {}
    sha = c.get("sha") or ""
    return {
        "id": f"github:commit:{repo.lower()}@{sha}",
        "platform": "github",
        "title": head.strip(),
        "url": c.get("html_url") or f"{WEB}/{repo}/commit/{sha}",
        "thumbnail": author.get("avatar_url"),
        "author": author.get("login") or who.get("name") or "",
        "source": repo,
        "published_at": _ts(who.get("date") or (commit.get("committer") or {}).get("date")),
        "score": None,
        "comments_count": commit.get("comment_count") or 0,
        "extra": {
            "type": "commit",
            "kind": "commit",
            "repo": repo,
            "sha": sha,
            "short": sha[:7],
            "body": body.strip()[:2000],
            "name": who.get("name"),
            "parents": len(c.get("parents") or []),
            "verified": bool((commit.get("verification") or {}).get("verified")),
            "text": head.strip(),
        },
    }


def normalize_user(u):
    login = u.get("login") or ""
    return {
        "id": f"github:user:{login.lower()}",
        "platform": "github",
        "title": u.get("name") or login,
        "url": u.get("html_url") or f"{WEB}/{login}",
        "thumbnail": u.get("avatar_url"),
        "author": login,
        "source": "Organisation" if u.get("type") == "Organization" else "GitHub user",
        "published_at": _ts(u.get("created_at")),
        "score": u.get("followers"),
        "comments_count": 0,
        "extra": {
            "type": "user",
            "kind": "ghuser",
            "login": login,
            "name": u.get("name"),
            "bio": u.get("bio"),
            "company": u.get("company"),
            "blog": u.get("blog") or None,
            "location": u.get("location"),
            "followers": u.get("followers"),
            "following": u.get("following"),
            "public_repos": u.get("public_repos"),
            "account_type": u.get("type"),
            "created_at": _ts(u.get("created_at")),
            "twitter": u.get("twitter_username"),
            "hireable": bool(u.get("hireable")),
        },
    }


def normalize(item):
    """A repo, release or event from the REST API in the standard feed-item shape."""
    if not item:
        return None
    if item.get("tag_name") and (item.get("zipball_url") is not None or item.get("tarball_url") is not None):
        return normalize_release(item)
    if item.get("type") and item.get("actor"):
        return normalize_event(item)
    return normalize_repo(item)


def normalize_event(item):
    event_type = item["type"]
    repo_name = (item.get("repo") or {}).get("name") or ""
    actor = item.get("actor") or {}
    payload = item.get("payload") or {}
    text, extra = _event_text(event_type, repo_name, payload)
    event_id = item.get("id") or repo_name or event_type
    url = extra.pop("url", None) or (f"{WEB}/{repo_name}" if repo_name else WEB)
    return {
        "id": f"github:event:{event_id}",
        "platform": "github",
        "title": f"[{repo_name}] {text}" if repo_name else text,
        "url": url,
        "thumbnail": actor.get("avatar_url"),
        "author": actor.get("login") or "",
        "source": repo_name,
        "published_at": _ts(item.get("created_at")),
        "score": None,
        "comments_count": 0,
        "extra": {
            "type": "event",
            "event_type": event_type,
            "repo": repo_name,
            "action": payload.get("action"),
            "actor": {"login": actor.get("login") or "", "avatar": actor.get("avatar_url")},
            "text": text,
            **extra,
        },
    }


def _event_text(event_type, repo, p):
    """(sentence, extra) for an event — written for the trimmed 2025 payloads,
    using whatever richer fields an older payload still carries."""
    action = p.get("action") or ""
    x = {}
    if event_type == "PushEvent":
        branch = (p.get("ref") or "").replace("refs/heads/", "")
        head, before = p.get("head") or "", p.get("before") or ""
        x.update(ref=branch, head=head[:7] or None, link="commit")
        if head and before and not set(before) <= {"0"}:
            x["url"] = f"{WEB}/{repo}/compare/{before[:12]}...{head[:12]}"
        elif head:
            x["url"] = f"{WEB}/{repo}/commit/{head}"
        commits = p.get("commits") or []
        if commits:
            n = p.get("size") or len(commits)
            msg = (commits[-1].get("message") or "").split("\n")[0]
            return f"{msg} ({n} commit{'s' if n != 1 else ''})", x
        return f"Pushed to {branch}" if branch else "Pushed", x
    if event_type in ("PullRequestEvent", "PullRequestReviewEvent", "PullRequestReviewCommentEvent"):
        pr = p.get("pull_request") or {}
        n = p.get("number") or pr.get("number")
        title = pr.get("title")
        if action == "closed" and pr.get("merged"):
            action = "merged"
        x.update(number=n, link="pull", url=pr.get("html_url") or f"{WEB}/{repo}/pull/{n}")
        if title:
            x["title"] = title
        if event_type == "PullRequestReviewEvent":
            state = ((p.get("review") or {}).get("state") or "").lower()
            verb = {"approved": "Approved", "changes_requested": "Requested changes on"}.get(state, "Reviewed")
            return f"{verb} pull request #{n}" + (f": {title}" if title else ""), x
        if event_type == "PullRequestReviewCommentEvent":
            x["excerpt"] = _excerpt((p.get("comment") or {}).get("body"))
            return f"Commented on the review of #{n}" + (f": {title}" if title else ""), x
        return f"{action.capitalize() or 'Updated'} pull request #{n}" + (f": {title}" if title else ""), x
    if event_type in ("IssuesEvent", "IssueCommentEvent"):
        issue = p.get("issue") or {}
        n = issue.get("number")
        kind = "pull" if issue.get("pull_request") is not None else "issue"
        x.update(number=n, title=issue.get("title"), link=kind,
                 url=issue.get("html_url") or f"{WEB}/{repo}/issues/{n}")
        if event_type == "IssueCommentEvent":
            comment = p.get("comment") or {}
            x["excerpt"] = _excerpt(comment.get("body"))
            if comment.get("html_url"):
                x["url"] = comment["html_url"]
            return f"Commented on #{n}: {issue.get('title', '')}", x
        if action == "labeled" and p.get("label"):
            return f"Labelled #{n} {p['label'].get('name')}: {issue.get('title', '')}", x
        return f"{action.capitalize() or 'Updated'} issue #{n}: {issue.get('title', '')}", x
    if event_type == "WatchEvent":
        x["link"] = "repo"
        return "Starred", x
    if event_type == "ForkEvent":
        forkee = (p.get("forkee") or {}).get("full_name", "")
        x.update(target=forkee or None, link="repo")
        return f"Forked → {forkee}" if forkee else "Forked", x
    if event_type == "CreateEvent":
        ref_type, ref = p.get("ref_type", ""), p.get("ref") or ""
        x.update(ref=ref or None, ref_type=ref_type, link="repo")
        if ref_type == "repository":
            return "Created the repository", x
        if ref_type == "tag" and ref:
            x["url"] = f"{WEB}/{repo}/releases/tag/{quote(ref)}"
        return f"Created {ref_type} {ref}".strip(), x
    if event_type == "DeleteEvent":
        x.update(ref=p.get("ref"), ref_type=p.get("ref_type"))
        return f"Deleted {p.get('ref_type', '')} {p.get('ref', '')}".strip(), x
    if event_type == "ReleaseEvent":
        rel = p.get("release") or {}
        x.update(tag=rel.get("tag_name"), link="release", url=rel.get("html_url"))
        return f"Released {rel.get('tag_name', '')}".strip(), x
    if event_type == "MemberEvent":
        who = (p.get("member") or {}).get("login", "")
        return f"Added {who} as a collaborator" if who else "Changed collaborators", x
    if event_type == "PublicEvent":
        return "Made the repository public", x
    if event_type == "GollumEvent":
        pages = p.get("pages") or []
        return f"Edited {len(pages)} wiki page{'s' if len(pages) != 1 else ''}" if pages else "Edited the wiki", x
    if event_type == "CommitCommentEvent":
        c = p.get("comment") or {}
        x.update(excerpt=_excerpt(c.get("body")), url=c.get("html_url"))
        return "Commented on a commit", x
    if event_type == "DiscussionEvent":
        d = p.get("discussion") or {}
        x.update(url=d.get("html_url"), title=d.get("title"))
        return f"{action.capitalize() or 'Started'} discussion: {d.get('title', '')}", x
    return event_type.replace("Event", ""), x


def _event_title(event_type, repo_name, payload):
    """Older entry point: the event's sentence with the repo in brackets."""
    text, _ = _event_text(event_type, repo_name, payload)
    return f"[{repo_name}] {text}"


# ── github.com pages ─────────────────────────────────────────────────────────

def _text(html_fragment):
    return htmllib.unescape(re.sub(r"<[^>]+>", "", html_fragment or "")).strip()


def _int(s):
    try:
        return int(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def parse_trending(page):
    """Repositories from github.com/trending, with the stars they gained in the window."""
    out = []
    for block in page.split('<article class="Box-row')[1:]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]*?href="/([^"/]+/[^"/?#]+)"', block)
        if not m:
            continue
        full = htmllib.unescape(m.group(1))
        owner, name = full.split("/", 1)
        desc = re.search(r'<p class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)</p>', block)
        lang = re.search(r'itemprop="programmingLanguage">([^<]+)<', block)
        color = re.search(r'repo-language-color"\s+style="background-color:\s*(#[0-9a-fA-F]{3,8})', block)
        stars = re.search(r'href="/' + re.escape(full) + r'/stargazers"[\s\S]*?</svg>\s*([\d,]+)', block)
        forks = re.search(r'href="/' + re.escape(full) + r'/forks"[\s\S]*?</svg>\s*([\d,]+)', block)
        gained = re.search(r'([\d,]+)\s+stars?\s+(today|this week|this month)', block)
        built = re.findall(r'<img class="avatar[^"]*" src="([^"]+)"[^>]*alt="@([^"]+)"', block)
        out.append({
            "id": f"github:repo:{full.lower()}",
            "platform": "github",
            "title": name,
            "url": f"{WEB}/{full}",
            "thumbnail": f"https://avatars.githubusercontent.com/{quote(owner)}?s=80",
            "author": owner,
            "source": full,
            "published_at": 0,
            "score": _int(stars.group(1)) if stars else None,
            "comments_count": 0,
            "extra": {
                "type": "repo",
                "description": _text(desc.group(1))[:300] if desc else "",
                "language": htmllib.unescape(lang.group(1)).strip() if lang else None,
                "lang_color": color.group(1) if color else None,
                "stars": _int(stars.group(1)) if stars else None,
                "forks": _int(forks.group(1)) if forks else None,
                "topics": [],
                "stars_gained": _int(gained.group(1)) if gained else None,
                "built_by": [{"login": login, "avatar": htmllib.unescape(src)} for src, login in built[:5]],
            },
        })
    return out


def parse_trending_developers(page):
    out = []
    for block in page.split('<article class="Box-row d-flex" id="pa-')[1:]:
        login = block.split('"', 1)[0]
        if not _NAME.match(login):
            continue
        avatar = re.search(r'<img class="rounded avatar-user" src="([^"]+)"', block)
        name = re.search(r'<h1 class="h3 lh-condensed"\s*>\s*<a[^>]*>([^<]+)</a>', block)
        repo = re.search(r'Popular repo[\s\S]*?href="/([^"]+)"', block)
        rdesc = re.search(r'Popular repo[\s\S]*?<div class="f6 color-fg-muted mt-1">\s*([\s\S]*?)\s*</div>', block)
        out.append({
            "login": login,
            "name": htmllib.unescape(name.group(1)).strip() if name else login,
            "avatar": htmllib.unescape(avatar.group(1)) if avatar else None,
            "repo": htmllib.unescape(repo.group(1)) if repo else None,
            "repo_description": _text(rdesc.group(1))[:200] if rdesc else None,
        })
    return out


def parse_contributions(page):
    """The public contribution calendar: {total, days: [{date, count, level}]}."""
    tips = {m.group(1): m.group(2)
            for m in re.finditer(r'<tool-tip[^>]*\sfor="([^"]+)"[^>]*>([^<]*)</tool-tip>', page)}
    days = []
    for m in re.finditer(r'<td\b([^>]*\bdata-date="[^"]+"[^>]*)>', page):
        attrs = m.group(1)
        date = re.search(r'data-date="([^"]+)"', attrs).group(1)
        lv = re.search(r'data-level="(\d)"', attrs)
        idm = re.search(r'\bid="([^"]+)"', attrs)
        tip = tips.get(idm.group(1), "") if idm else ""
        cm = re.match(r"\s*(\d[\d,]*)\s+contribution", tip)
        days.append({"date": date, "count": _int(cm.group(1)) if cm else 0, "level": int(lv.group(1)) if lv else 0})
    days.sort(key=lambda d: d["date"])
    flat = re.sub(r"\s+", " ", page)
    total = re.search(r"([\d,]+) contributions? in the last year", flat)
    return {"total": _int(total.group(1)) if total else sum(d["count"] for d in days), "days": days}


def parse_atom(xml_text):
    """A github.com Atom feed: [{id, title, url, updated, author, author_uri, thumb, content}]."""
    import xml.etree.ElementTree as ET

    ns = {"a": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/"}
    root = ET.fromstring(xml_text)
    out = []
    for e in root.findall("a:entry", ns):
        link = e.find("a:link", ns)
        thumb = e.find("media:thumbnail", ns)
        out.append({
            "id": (e.findtext("a:id", "", ns) or "").strip(),
            "title": re.sub(r"\s+", " ", e.findtext("a:title", "", ns) or "").strip(),
            "url": link.get("href") if link is not None else "",
            "updated": (e.findtext("a:updated", "", ns) or "").strip(),
            "author": (e.findtext("a:author/a:name", "", ns) or "").strip(),
            "author_uri": (e.findtext("a:author/a:uri", "", ns) or "").strip(),
            "thumb": thumb.get("url") if thumb is not None else None,
            "content": e.findtext("a:content", "", ns) or "",
        })
    return out


def _atom_commits(repo, entries):
    items = []
    for en in entries:
        m = re.search(r"/commit/([0-9a-f]{7,40})", en["url"])
        if not m:
            continue
        sha = m.group(1)
        body = _text(en["content"])
        head, _, rest = body.partition("\n")
        login = en["author_uri"].rsplit("/", 1)[-1] if en["author_uri"] else ""
        items.append({
            "id": f"github:commit:{repo.lower()}@{sha}",
            "platform": "github",
            "title": en["title"] or head,
            "url": en["url"],
            "thumbnail": en["thumb"],
            "author": login or en["author"],
            "source": repo,
            "published_at": _ts(en["updated"]),
            "score": None,
            "comments_count": 0,
            "extra": {"type": "commit", "kind": "commit", "repo": repo, "sha": sha, "short": sha[:7],
                      "body": rest.strip()[:600], "text": en["title"] or head},
        })
    return items


def _atom_releases(repo, entries):
    items = []
    for en in entries:
        m = re.search(r"/releases/tag/([^?#]+)$", en["url"])
        tag = htmllib.unescape(unquote(m.group(1))) if m else en["title"]
        items.append({
            "id": f"github:release:{repo.lower()}@{tag}",
            "platform": "github",
            "title": en["title"] or tag,
            "url": en["url"],
            "thumbnail": en["thumb"] or f"https://avatars.githubusercontent.com/{quote(repo.split('/')[0])}?s=80",
            "author": en["author"],
            "source": repo,
            "published_at": _ts(en["updated"]),
            "score": None,
            "comments_count": 0,
            "extra": {"type": "release", "repo": repo, "tag": tag, "prerelease": bool(re.search(r"(alpha|beta|rc|pre|dev)", tag, re.I)),
                      "notes_html": en["content"][:40000] or None, "text": en["title"] or tag, "from": "atom"},
        })
    return items


def repo_commits_atom(repo):
    data, _ = _web(f"/{repo}/commits.atom", config.TTL_GITHUB_ATOM, f"github:atom:commits:{repo.lower()}",
                   lambda t: _atom_commits(repo, parse_atom(t)))
    return data or []


def repo_releases_atom(repo):
    data, _ = _web(f"/{repo}/releases.atom", config.TTL_GITHUB_ATOM, f"github:atom:releases:{repo.lower()}",
                   lambda t: _atom_releases(repo, parse_atom(t)))
    return data or []


# ── the followed feed ────────────────────────────────────────────────────────

def _repo_recent_issues(repo):
    since = (datetime.now(timezone.utc) - timedelta(days=FEED_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    data, _, _ = _cached(
        f"github:feed:issues:{repo.lower()}", _feed_ttl(), f"/repos/{repo}/issues",
        params={"state": "all", "sort": "updated", "direction": "desc", "per_page": 20, "since": since},
        shape=lambda d: [normalize_issue(i, repo) for i in d or []],
    )
    return data or []


def _fetch_repo_activity(source_id):
    """A followed repo's last fortnight (commits, releases, issues and PRs), or a
    followed person's public events."""
    items = []
    if "/" in source_id:
        cutoff = time.time() - FEED_DAYS * 86400
        for fn in (repo_commits_atom, repo_releases_atom, _repo_recent_issues):
            try:
                got = fn(source_id)
            except Exception:
                continue
            items.extend(i for i in got if (i.get("published_at") or 0) >= cutoff or i["extra"]["type"] == "release")
        # Releases stay even when older than the window, but only the latest three.
        rel = [i for i in items if i["extra"]["type"] == "release"]
        for old in sorted(rel, key=lambda i: i["published_at"], reverse=True)[3:]:
            items.remove(old)
    else:
        try:
            data, _, _ = _cached(
                f"github:feed:user:{source_id.lower()}", _feed_ttl(), f"/users/{quote(source_id)}/events/public",
                params={"per_page": 30}, shape=lambda d: [normalize(e) for e in d or [] if e],
            )
            items.extend(data or [])
        except Exception:
            pass
    return [i for i in items if i]


def get_feed(list_name=None, page=0):
    """Activity from the repos and people followed in Tubcal, newest first."""
    from .. import db as tubcal_db

    subs = tubcal_db.list_subscriptions("github")
    if not subs:
        return {"items": [], "has_more": False, "stale": False}
    with ThreadPoolExecutor(max_workers=8) as ex:
        all_lists = list(ex.map(_fetch_repo_activity, [s["source_id"] for s in subs]))
    seen, items = set(), []
    for item in (i for lst in all_lists for i in lst):
        if item["id"] not in seen:
            seen.add(item["id"])
            items.append(item)
    items.sort(key=lambda i: i.get("published_at") or 0, reverse=True)
    start = page * FEED_PAGE
    return {"items": items[start: start + FEED_PAGE], "has_more": start + FEED_PAGE < len(items), "stale": False}


def release_radar(limit=120):
    """Releases from every followed repo — plus your 30 latest stars when an
    account is linked — newest first. All from releases.atom, so no API budget."""
    from .. import db as tubcal_db

    repos = [s["source_id"] for s in tubcal_db.list_subscriptions("github") if "/" in s["source_id"]]
    starred = []
    if _token():
        try:
            starred = [s["source"] for s in stars(0)["items"]]
        except Exception:
            starred = []
    seen, order = set(), []
    for r in repos + starred:
        if r.lower() not in seen:
            seen.add(r.lower())
            order.append(r)
    order = order[:40]
    followed = {r.lower() for r in repos}

    def one(repo):
        try:
            return repo_releases_atom(repo)[:6]
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=8) as ex:
        lists = list(ex.map(one, order))
    items = []
    for lst in lists:
        for it in lst:
            it = {**it, "extra": {**it["extra"], "followed": it["source"].lower() in followed}}
            items.append(it)
    items.sort(key=lambda i: i.get("published_at") or 0, reverse=True)
    return {"items": items[:limit], "repos": len(order)}


# ── trending ─────────────────────────────────────────────────────────────────

_PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}


def _lang_slug(language):
    return quote(language.strip().lower().replace(" ", "-"), safe="+")


def _trending_by_search(period, language, page):
    days = _PERIOD_DAYS.get(period, 1)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    q = f"created:>{since}" + (f" language:{language}" if language else "")
    data, _, stale = _cached(
        f"github:trending-search:{period}:{(language or 'all').lower()}:{page}", config.TTL_GITHUB_TRENDING,
        "/search/repositories", params={"q": q, "sort": "stars", "order": "desc", "per_page": PAGE_SIZE, "page": page + 1},
        shape=lambda d: [normalize_repo(r) for r in (d or {}).get("items") or []],
    )
    return data or [], stale


def trending(period="daily", language=None, page=0):
    """Trending repos, from github.com/trending (with the stars each gained in the
    window). If that page can't be read, falls back to the old stand-in: repos
    created in the window, by stars, from the search API."""
    period = period if period in _PERIOD_DAYS else "daily"
    path = "/trending" + (f"/{_lang_slug(language)}" if language else "") + f"?since={period}"
    if page == 0:
        try:
            items, stale = _web(path, config.TTL_GITHUB_TRENDING,
                                f"github:trending:{period}:{(language or 'all').lower()}", parse_trending)
            if items:
                return {"items": items, "has_more": False, "stale": stale, "source": "github.com"}
        except Exception:
            pass
    items, stale = _trending_by_search(period, language, page)
    return {"items": items, "has_more": len(items) == PAGE_SIZE, "stale": stale, "source": "search"}


def trending_developers(period="daily", language=None):
    period = period if period in _PERIOD_DAYS else "daily"
    path = "/trending/developers" + (f"/{_lang_slug(language)}" if language else "") + f"?since={period}"
    items, stale = _web(path, config.TTL_GITHUB_TRENDING,
                        f"github:trending-devs:{period}:{(language or 'all').lower()}", parse_trending_developers)
    return {"items": items or [], "stale": stale}


# ── search ───────────────────────────────────────────────────────────────────

_SORTS = {
    "repos": {"stars", "forks", "updated", "help-wanted-issues"},
    "users": {"followers", "repositories", "joined"},
    "issues": {"comments", "created", "updated", "reactions"},
    "code": set(),
}


def search(query, page=0, scope="repos", sort=None, language=None):
    """Search repositories, people, issues and PRs — and code, with a token."""
    scope = scope if scope in _SORTS else "repos"
    sort = sort if sort in _SORTS[scope] else None
    q = query + (f" language:{language}" if language and scope in ("repos", "code") else "")
    if scope == "code" and not _token():
        raise GitHubError("Searching code needs a linked GitHub account.", 401, "unlinked")
    path = {"repos": "/search/repositories", "users": "/search/users", "issues": "/search/issues",
            "code": "/search/code"}[scope]
    params = {"q": q, "per_page": PAGE_SIZE, "page": page + 1}
    if sort:
        params.update(sort=sort, order="desc")
    accept = "application/vnd.github.text-match+json" if scope == "code" else _JSON

    def shape(d):
        d = d or {}
        raw = d.get("items") or []
        if scope == "repos":
            items = [normalize_repo(r) for r in raw]
        elif scope == "users":
            items = [{
                "id": f"github:user:{(u.get('login') or '').lower()}", "platform": "github",
                "title": u.get("login"), "url": u.get("html_url"), "thumbnail": u.get("avatar_url"),
                "author": u.get("login"), "source": "Organisation" if u.get("type") == "Organization" else "GitHub user",
                "published_at": 0, "score": None, "comments_count": 0,
                "extra": {"type": "user", "kind": "ghuser", "login": u.get("login"), "account_type": u.get("type")},
            } for u in raw]
        elif scope == "issues":
            items = [normalize_issue(i) for i in raw]
        else:
            items = [{
                "id": f"github:code:{(c.get('repository') or {}).get('full_name', '')}/{c.get('path')}",
                "platform": "github", "title": c.get("name"), "url": c.get("html_url"),
                "thumbnail": ((c.get("repository") or {}).get("owner") or {}).get("avatar_url"),
                "author": ((c.get("repository") or {}).get("owner") or {}).get("login"),
                "source": (c.get("repository") or {}).get("full_name"), "published_at": 0, "score": None,
                "comments_count": 0,
                "extra": {"type": "code", "path": c.get("path"), "repo": (c.get("repository") or {}).get("full_name"),
                          "fragments": [m.get("fragment") for m in c.get("text_matches") or [] if m.get("fragment")][:3]},
            } for c in raw]
        return {"items": items, "total": d.get("total_count") or 0, "incomplete": bool(d.get("incomplete_results"))}

    key = f"github:search:{scope}:{sort or '-'}:{(language or '').lower()}:{query.lower()}:{page}"
    if scope == "code":
        key = f"github:my:{_token_tag(_token())}:{key}"
    data, has_next, stale = _cached(key, config.TTL_GITHUB_SEARCH, path, params=params, accept=accept, shape=shape)
    items = list(data["items"])

    # Fuzzy fallback for a thin repo search: near-misses among the cached feed.
    if scope == "repos" and page == 0 and len(items) < 5:
        from .. import db as tubcal_db
        candidates = []
        for s in tubcal_db.list_subscriptions("github")[:8]:
            for k in (f"github:atom:releases:{s['source_id'].lower()}", f"github:atom:commits:{s['source_id'].lower()}"):
                got = cache.peek(k)
                if isinstance(got, list):
                    candidates.extend(got)
        if candidates:
            seen = {i["id"] for i in items}
            for hit, _score in fuzzy_filter(candidates, query, threshold=60, limit=10):
                if hit["id"] not in seen:
                    seen.add(hit["id"])
                    items.append(hit)
    return {"items": items, "total": data["total"], "has_more": has_next, "stale": stale, "scope": scope}


# ── a repository ─────────────────────────────────────────────────────────────

def repo(full):
    full = _split(full)
    data, _, stale = _cached(f"github:repo2:{full.lower()}", config.TTL_GITHUB_ITEM, f"/repos/{full}",
                             shape=normalize_repo)
    return data, stale


def languages(full):
    full = _split(full)
    data, _, _ = _cached(f"github:langs:{full.lower()}", config.TTL_GITHUB_PARTICIPATION, f"/repos/{full}/languages")
    total = sum((data or {}).values()) or 1
    return [{"name": k, "bytes": v, "share": v / total}
            for k, v in sorted((data or {}).items(), key=lambda kv: kv[1], reverse=True)]


def participation(full):
    """52 weekly commit counts (all, and the owner's), oldest first. GitHub
    computes these lazily, answering 202 until it's done — that's cached
    briefly so the next look picks the numbers up."""
    full = _split(full)

    def fetch():
        resp = _api("GET", f"/repos/{full}/stats/participation")
        if resp.status_code == 202 or not resp.content:
            return None, 60
        d = resp.json() or {}
        return {"all": d.get("all") or [], "owner": d.get("owner") or []}, config.TTL_GITHUB_PARTICIPATION

    return cache.cached_dynamic(f"github:participation:{full.lower()}", fetch)


def readme(full, ref=None):
    full = _split(full)
    params = {"ref": ref} if ref else None
    try:
        data, _, _ = _cached(f"github:readme2:{full.lower()}:{ref or ''}", config.TTL_GITHUB_ITEM,
                             f"/repos/{full}/readme", params=params, accept=_HTML, raw=True)
        return data
    except GitHubError as e:
        if e.kind == "not_found":
            return None
        raise


def get_readme(full_name):
    """README as rendered HTML, or None (kept for the phone's repo reader)."""
    try:
        return readme(full_name)
    except Exception:
        return None


def branches(full):
    full = _split(full)
    data, _, _ = _cached(f"github:branches:{full.lower()}", config.TTL_GITHUB_TREE, f"/repos/{full}/branches",
                         params={"per_page": 100},
                         shape=lambda d: [{"name": b.get("name"), "protected": bool(b.get("protected")),
                                           "sha": (b.get("commit") or {}).get("sha")} for b in d or []])
    return data or []


def _clean_path(path):
    path = (path or "").strip("/")
    parts = [p for p in path.split("/") if p]
    if any(p in (".", "..") for p in parts):
        raise GitHubError("That isn't a path in the repository.", 400, "invalid")
    return "/".join(parts)


def tree(full, ref=None, path=""):
    """A directory: folders first, then files, by name."""
    full, path = _split(full), _clean_path(path)
    params = {"ref": ref} if ref else None

    def shape(d):
        if isinstance(d, dict):  # a file, not a folder: hand the file over as well
            return {"file": True, "entries": [], "blob": _file_shape(d, path)}
        order = {"dir": 0, "submodule": 1, "symlink": 2, "file": 3}
        entries = [{"name": e.get("name"), "path": e.get("path"), "type": e.get("type"), "size": e.get("size"),
                    "sha": e.get("sha")} for e in d or []]
        entries.sort(key=lambda e: (order.get(e["type"], 4), (e["name"] or "").lower()))
        return {"file": False, "entries": entries}

    data, _, stale = _cached(f"github:tree:{full.lower()}:{ref or ''}:{path}", config.TTL_GITHUB_TREE,
                             f"/repos/{full}/contents/{quote(path)}", params=params, shape=shape)
    return {**data, "path": path, "ref": ref, "stale": stale}


_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp"}
_MARKUP = {"md", "markdown", "mdx", "rst", "adoc", "org"}
MAX_FILE_TEXT = 512 * 1024


def _ext(path):
    name = path.rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _file_shape(d, path):
    """A contents-API file as the code view wants it: text when it's text."""
    size = d.get("size") or 0
    ext = _ext(path)
    out = {"name": d.get("name"), "path": d.get("path"), "size": size, "sha": d.get("sha"),
           "html_url": d.get("html_url"), "download_url": d.get("download_url"), "markup": ext in _MARKUP,
           "text": None, "binary": False, "too_large": False, "image": ext in _IMAGE_EXT, "lines": 0}
    if out["image"]:
        return out
    raw = d.get("content")
    if d.get("encoding") != "base64" or raw is None or size > MAX_FILE_TEXT:
        out["too_large"] = size > MAX_FILE_TEXT or d.get("encoding") == "none"
        return out
    blob = b64decode(raw)
    if b"\x00" in blob[:8000]:
        out["binary"] = True
        return out
    try:
        text = blob.decode("utf-8")
    except UnicodeDecodeError:
        text = blob.decode("latin-1")
    out["text"] = text
    out["lines"] = text.count("\n") + (0 if text.endswith("\n") or not text else 1)
    return out


def file(full, ref=None, path="", render=False):
    """One file: its text when it's text (≤512 KB), an image URL when it's a
    picture, GitHub's own rendering for Markdown when `render`."""
    full, path = _split(full), _clean_path(path)
    if not path:
        raise GitHubError("Which file?", 400, "invalid")
    params = {"ref": ref} if ref else None
    ext = _ext(path)

    def shape(d):
        return _file_shape(d, path) if isinstance(d, dict) else {"folder": True}

    data, _, stale = _cached(f"github:file:{full.lower()}:{ref or ''}:{path}", config.TTL_GITHUB_FILE,
                             f"/repos/{full}/contents/{quote(path)}", params=params, shape=shape)
    data = dict(data)
    if render and ext in _MARKUP:
        try:
            data["html"], _, _ = _cached(f"github:filehtml:{full.lower()}:{ref or ''}:{path}", config.TTL_GITHUB_FILE,
                                         f"/repos/{full}/contents/{quote(path)}", params=params, accept=_HTML, raw=True)
        except GitHubError:
            data["html"] = None
    data["stale"] = stale
    return data


def commits(full, ref=None, path=None, page=0):
    full = _split(full)
    params = {"per_page": PAGE_SIZE, "page": page + 1}
    if ref:
        params["sha"] = ref
    if path:
        params["path"] = _clean_path(path)
    data, has_next, stale = _cached(
        f"github:commits:{full.lower()}:{ref or ''}:{params.get('path', '')}:{page}", config.TTL_GITHUB_COMMITS,
        f"/repos/{full}/commits", params=params, shape=lambda d: [normalize_commit(c, full) for c in d or []],
    )
    return {"items": data or [], "has_more": has_next, "stale": stale}


MAX_PATCH = 120 * 1024


def _files(raw):
    out = []
    for f in raw or []:
        patch = f.get("patch")
        out.append({
            "name": f.get("filename"), "previous": f.get("previous_filename"), "status": f.get("status"),
            "additions": f.get("additions") or 0, "deletions": f.get("deletions") or 0,
            "patch": patch if patch and len(patch) <= MAX_PATCH else None,
            "patch_cut": bool(patch and len(patch) > MAX_PATCH),
        })
    return out


def commit(full, sha):
    full = _split(full)
    if not re.match(r"^[0-9A-Za-z._/-]{4,100}$", sha or ""):
        raise GitHubError("That isn't a commit.", 400, "invalid")

    def shape(c):
        item = normalize_commit(c, full)
        stats = c.get("stats") or {}
        item["extra"].update(
            additions=stats.get("additions") or 0, deletions=stats.get("deletions") or 0,
            files=_files(c.get("files")), parent_shas=[p.get("sha") for p in c.get("parents") or []],
            committer=((c.get("commit") or {}).get("committer") or {}).get("name"),
        )
        return item

    data, _, _ = _cached(f"github:commit:{full.lower()}@{sha}", config.TTL_GITHUB_FILE,
                         f"/repos/{full}/commits/{quote(sha)}", shape=shape)
    return data


def issues(full, kind="issue", state="open", page=0):
    full = _split(full)
    state = state if state in ("open", "closed", "all") else "open"
    if kind == "pull":
        path, params = f"/repos/{full}/pulls", {"state": state, "sort": "updated", "direction": "desc",
                                                 "per_page": PAGE_SIZE, "page": page + 1}
        shape = lambda d: [normalize_issue(i, full) for i in d or []]  # noqa: E731
    else:
        path, params = f"/repos/{full}/issues", {"state": state, "sort": "updated", "direction": "desc",
                                                  "per_page": PAGE_SIZE, "page": page + 1}
        shape = lambda d: [normalize_issue(i, full) for i in d or [] if "pull_request" not in i]  # noqa: E731
    data, has_next, stale = _cached(f"github:issues:{full.lower()}:{kind}:{state}:{page}", config.TTL_GITHUB_THREAD,
                                    path, params=params, shape=shape)
    return {"items": data or [], "has_more": has_next, "stale": stale}


def _comment(c):
    user = c.get("user") or {}
    return {
        "id": c.get("id"), "author": user.get("login") or "ghost", "avatar": user.get("avatar_url"),
        "association": c.get("author_association"), "created_at": _ts(c.get("created_at") or c.get("submitted_at")),
        "updated_at": _ts(c.get("updated_at")), "html": c.get("body_html") or "", "url": c.get("html_url"),
        "reactions": (c.get("reactions") or {}).get("total_count") or 0,
    }


def thread(full, number, page=0):
    """An issue or pull request with its conversation. A pull request adds its
    branches, size, reviews and — with a token — its checks."""
    full = _split(full)
    number = int(number)
    head, _, _ = _cached(f"github:thread:{full.lower()}#{number}", config.TTL_GITHUB_THREAD,
                         f"/repos/{full}/issues/{number}", accept=_FULL)
    item = normalize_issue(head, full)
    out = {"item": item, "body_html": head.get("body_html") or "", "locked": bool(head.get("locked"))}
    comments, has_next, _ = _cached(
        f"github:thread-comments:{full.lower()}#{number}:{page}", config.TTL_GITHUB_THREAD,
        f"/repos/{full}/issues/{number}/comments", params={"per_page": 100, "page": page + 1}, accept=_FULL,
        shape=lambda d: [_comment(c) for c in d or []],
    )
    out["comments"] = comments or []
    out["more_comments"] = has_next
    if item["extra"]["kind"] == "pull":
        pr, _, _ = _cached(f"github:pull:{full.lower()}#{number}", config.TTL_GITHUB_THREAD,
                           f"/repos/{full}/pulls/{number}")
        out["pull"] = {
            "head": (pr.get("head") or {}).get("label"), "base": (pr.get("base") or {}).get("ref"),
            "head_sha": (pr.get("head") or {}).get("sha"), "merged": bool(pr.get("merged")),
            "merged_by": ((pr.get("merged_by") or {}).get("login")), "mergeable_state": pr.get("mergeable_state"),
            "draft": bool(pr.get("draft")), "commits": pr.get("commits"), "additions": pr.get("additions"),
            "deletions": pr.get("deletions"), "changed_files": pr.get("changed_files"),
            "reviewers": [_user(u) for u in pr.get("requested_reviewers") or []],
        }
        if pr.get("merged_at"):
            item["extra"]["state"] = "merged"
        try:
            reviews, _, _ = _cached(
                f"github:reviews:{full.lower()}#{number}", config.TTL_GITHUB_THREAD, f"/repos/{full}/pulls/{number}/reviews",
                params={"per_page": 100}, accept=_FULL,
                shape=lambda d: [{**_comment(r), "state": (r.get("state") or "").lower()} for r in d or []
                                 if r.get("state") != "PENDING"],
            )
            out["reviews"] = reviews or []
        except GitHubError:
            out["reviews"] = []
        sha = out["pull"]["head_sha"]
        if sha and _token():
            try:
                checks, _, _ = _cached(
                    f"github:checks:{full.lower()}@{sha}", 120, f"/repos/{full}/commits/{sha}/check-runs",
                    params={"per_page": 100},
                    shape=lambda d: [{"name": r.get("name"), "status": r.get("status"), "conclusion": r.get("conclusion"),
                                      "url": r.get("html_url")} for r in (d or {}).get("check_runs") or []],
                )
                out["checks"] = checks or []
            except GitHubError:
                out["checks"] = None
    return out


def pull_files(full, number, page=0):
    full = _split(full)
    data, has_next, _ = _cached(f"github:pull-files:{full.lower()}#{int(number)}:{page}", config.TTL_GITHUB_THREAD,
                                f"/repos/{full}/pulls/{int(number)}/files", params={"per_page": 100, "page": page + 1},
                                shape=_files)
    return {"files": data or [], "has_more": has_next}


def releases(full, page=0):
    full = _split(full)
    data, has_next, stale = _cached(
        f"github:releases2:{full.lower()}:{page}", config.TTL_GITHUB_RELEASES, f"/repos/{full}/releases",
        params={"per_page": 10, "page": page + 1}, accept="application/vnd.github.html+json",
        shape=lambda d: [normalize_release(r, full) for r in d or []],
    )
    return {"items": data or [], "has_more": has_next, "stale": stale}


def contributors(full):
    full = _split(full)
    data, _, _ = _cached(f"github:contributors:{full.lower()}", config.TTL_GITHUB_PARTICIPATION,
                         f"/repos/{full}/contributors", params={"per_page": 40},
                         shape=lambda d: [{"login": c.get("login"), "avatar": c.get("avatar_url"),
                                           "contributions": c.get("contributions") or 0, "type": c.get("type")}
                                          for c in d or [] if c.get("login")])
    return data or []


def get_item(full_name):
    """Repo detail with its latest releases and README (the phone's repo reader)."""
    story, stale = repo(full_name)
    try:
        rel = releases(full_name)["items"][:5]
    except Exception:
        rel = []
    return {"story": story, "releases": rel, "readme_html": get_readme(full_name) if story else None, "stale": stale}


def resolve(raw):
    """Resolve a typed "owner/repo", URL or username to a display record.
    Raises LookupError if GitHub has no such thing."""
    source_id = raw.strip().lstrip("@")
    for prefix in ("https://github.com/", "http://github.com/", "github.com/"):
        if source_id.lower().startswith(prefix):
            source_id = source_id[len(prefix):]
    source_id = source_id.strip("/")
    if not source_id:
        raise LookupError("invalid input")
    if "/" in source_id:
        owner, name = source_id.split("/", 1)
        source_id = f"{owner}/{name.split('/')[0]}"
        try:
            data = _fetch(f"/repos/{quote(source_id)}")
        except GitHubError as e:
            if e.kind in ("not_found", "invalid"):
                raise LookupError(f"repo '{source_id}' not found")
            raise
        return {"source_id": data.get("full_name") or source_id, "name": data.get("full_name") or source_id,
                "title": data.get("full_name") or source_id, "icon": (data.get("owner") or {}).get("avatar_url"),
                "type": "repo"}
    try:
        data = _fetch(f"/users/{quote(source_id)}")
    except GitHubError as e:
        if e.kind in ("not_found", "invalid"):
            raise LookupError(f"user '{source_id}' not found")
        raise
    login = data.get("login") or source_id
    return {"source_id": login, "name": login, "title": data.get("name") or login,
            "icon": data.get("avatar_url"), "type": "user"}


def following_cards():
    """The repos and people followed in Tubcal, each with its numbers and what it
    did last (from the free Atom feeds where possible)."""
    from .. import db as tubcal_db

    subs = tubcal_db.list_subscriptions("github")

    def card(s):
        sid = s["source_id"]
        out = {"id": s["id"], "source_id": sid, "name": s.get("display_name") or sid, "thumbnail": s.get("thumbnail"),
               "kind": "repo" if "/" in sid else "user"}
        try:
            if out["kind"] == "repo":
                out["repo"], _ = repo(sid)
                rel = repo_releases_atom(sid)
                out["release"] = rel[0] if rel else None
                com = repo_commits_atom(sid)
                out["commit"] = com[0] if com else None
            else:
                out["user"] = user(sid)
        except Exception as e:
            out["error"] = str(e)
        return out

    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(card, subs))


# ── people ───────────────────────────────────────────────────────────────────

def user(login):
    login = check_owner(login)
    data, _, _ = _cached(f"github:user:{login.lower()}", config.TTL_GITHUB_USER, f"/users/{login}",
                         shape=normalize_user)
    return data


def user_repos(login, sort="pushed", page=0):
    login = check_owner(login)
    if sort == "stars":
        res = search(f"user:{login} fork:true", page=page, scope="repos", sort="stars")
        return {"items": res["items"], "has_more": res["has_more"]}
    sort = sort if sort in ("pushed", "updated", "created", "full_name") else "pushed"
    me = account()
    if me.get("linked") and me.get("login", "").lower() == login.lower():
        path, params = "/user/repos", {"sort": sort, "per_page": PAGE_SIZE, "page": page + 1, "affiliation": "owner"}
        key = f"github:my:{me['login'].lower()}:repos:{sort}:{page}"
    else:
        path, params = f"/users/{login}/repos", {"sort": sort, "per_page": PAGE_SIZE, "page": page + 1, "type": "owner"}
        key = f"github:user-repos:{login.lower()}:{sort}:{page}"
    data, has_next, _ = _cached(key, config.TTL_GITHUB_USER, path, params=params,
                                shape=lambda d: [normalize_repo(r) for r in d or []])
    return {"items": data or [], "has_more": has_next}


_LEVELS = {"NONE": 0, "FIRST_QUARTILE": 1, "SECOND_QUARTILE": 2, "THIRD_QUARTILE": 3, "FOURTH_QUARTILE": 4}


def contributions(login):
    """A year of contributions. Your own comes from GraphQL with the token (so it
    counts private work); anyone else's from their public calendar."""
    login = check_owner(login)
    me = account()
    if me.get("linked") and me.get("login", "").lower() == login.lower():
        q = ("query { viewer { contributionsCollection { contributionCalendar { totalContributions "
             "weeks { contributionDays { date contributionCount contributionLevel } } } } } }")

        def fetch():
            resp = _api("POST", "/graphql", json={"query": q})
            cal = (((resp.json().get("data") or {}).get("viewer") or {}).get("contributionsCollection") or {}) \
                .get("contributionCalendar") or {}
            days = [{"date": d["date"], "count": d["contributionCount"], "level": _LEVELS.get(d["contributionLevel"], 0)}
                    for w in cal.get("weeks") or [] for d in w.get("contributionDays") or []]
            return {"total": cal.get("totalContributions") or 0, "days": days, "private": True}

        try:
            data, _ = cache.cached(f"github:my:{login.lower()}:contrib", config.TTL_GITHUB_CONTRIB, fetch)
            return data
        except GitHubError:
            pass
    data, _ = _web(f"/users/{login}/contributions", config.TTL_GITHUB_CONTRIB, f"github:contrib:{login.lower()}",
                   parse_contributions)
    return data


# ── the linked account ───────────────────────────────────────────────────────

_gh_cli = {"at": 0, "value": None}


def gh_cli():
    """Is the GitHub CLI installed and signed in to github.com? Cached for 30s."""
    if time.time() - _gh_cli["at"] < 30 and _gh_cli["value"] is not None:
        return _gh_cli["value"]
    out = {"installed": bool(shutil.which("gh")), "logged_in": False, "login": None}
    if out["installed"]:
        try:
            r = subprocess.run(["gh", "auth", "status", "--hostname", "github.com"], capture_output=True,
                               text=True, timeout=8)
            out["logged_in"] = r.returncode == 0
            m = re.search(r"account (\S+)", (r.stdout or "") + (r.stderr or ""))
            if m:
                out["login"] = m.group(1)
        except (OSError, subprocess.SubprocessError):
            pass
    _gh_cli.update(at=time.time(), value=out)
    return out


def capabilities(scopes, token=""):
    """What the token may do, from its OAuth scopes. A fine-grained token (or a
    GitHub App's) sends no scope list: its permissions only show when tried —
    except notifications, which GitHub never opens to those."""
    fine = scopes is None or token.startswith("github_pat_") or token.startswith("ghu_")
    if fine:
        return {"notifications": False, "star": True, "follow": True, "comment": True, "private": True,
                "code_search": True, "fine_grained": True}
    s = set(scopes)
    repo_rw = bool(s & {"repo", "public_repo"})
    return {
        "notifications": bool(s & {"notifications", "repo"}),
        "star": repo_rw,
        "follow": bool(s & {"user", "user:follow"}),
        "comment": repo_rw,
        "private": "repo" in s,
        "code_search": True,
        "fine_grained": False,
    }


def _source_of_link():
    from .. import db
    row = db.get_oauth("github")
    if row and row.get("access_token"):
        meta = db.get_setting("_github_link") or {}
        return meta.get("source") or "token"
    if db.get_setting("github_token"):
        return "setting"
    return "env" if os.environ.get("TUBCAL_GITHUB_TOKEN") else None


def account():
    """Who the linked token belongs to and what it may do; {linked: False} if none."""
    tok = _token()
    if not tok:
        return {"linked": False}

    def fetch():
        resp = _api("GET", "/user", token=tok)
        u = resp.json() or {}
        hdr = resp.headers.get("X-OAuth-Scopes")
        scopes = [x.strip() for x in hdr.split(",") if x.strip()] if hdr is not None else None
        return {"login": u.get("login"), "name": u.get("name"), "avatar": u.get("avatar_url"),
                "html_url": u.get("html_url"), "scopes": scopes, "followers": u.get("followers"),
                "following": u.get("following"), "public_repos": u.get("public_repos"),
                "private_repos": u.get("total_private_repos")}

    try:
        me, _ = cache.cached(f"github:me:{_token_tag(tok)}", config.TTL_GITHUB_ME, fetch)
    except GitHubError as e:
        return {"linked": False, "broken": True, "error": str(e), "source": _source_of_link()}
    return {"linked": True, **me, "can": capabilities(me.get("scopes"), tok), "source": _source_of_link()}


def _me():
    me = account()
    if not me.get("linked"):
        raise GitHubError("Link a GitHub account in Settings → Accounts to see this.", 401, "unlinked")
    return me


def _need(cap, what):
    me = _me()
    if not me["can"].get(cap):
        hint = {
            "notifications": "a classic token or the GitHub CLI login (fine-grained tokens can't read notifications)",
            "follow": "the user:follow scope (gh auth refresh -s user:follow)",
            "star": "the public_repo or repo scope", "comment": "the public_repo or repo scope",
        }.get(cap, "another scope")
        raise GitHubError(f"{what} needs {hint}.", 403, "scope")
    return me


def link_token(token, source="token"):
    token = (token or "").strip()
    if not re.match(r"^[A-Za-z0-9_]{20,255}$", token):
        raise GitHubError("That doesn't look like a GitHub token.", 400, "invalid")
    resp = _api("GET", "/user", token=token)
    hdr = resp.headers.get("X-OAuth-Scopes")
    from .. import db
    db.set_oauth_token("github", token, scopes=hdr)
    db.set_setting("_github_link", {"source": source, "linked_at": int(time.time())})
    cache.invalidate("github:me:")
    cache.invalidate("github:my:")
    return account()


def link_gh_cli():
    status = gh_cli()
    if not status["installed"]:
        raise GitHubError("The GitHub CLI (gh) isn't installed on this machine.", 400, "invalid")
    if not status["logged_in"]:
        raise GitHubError("The GitHub CLI isn't signed in. Run `gh auth login` first.", 400, "invalid")
    try:
        r = subprocess.run(["gh", "auth", "token", "--hostname", "github.com"], capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.SubprocessError) as e:
        raise GitHubError(f"Couldn't ask gh for its token: {e}", 502, "upstream") from None
    if r.returncode != 0 or not r.stdout.strip():
        raise GitHubError("gh didn't hand over a token.", 502, "upstream")
    return link_token(r.stdout.strip(), source="gh")


def unlink():
    from .. import db
    db.delete_oauth("github")
    db.delete_setting("_github_link")
    cache.invalidate("github:me:")
    cache.invalidate("github:my:")
    return account()


# ── the inbox ────────────────────────────────────────────────────────────────

def notification_target(subject, repo):
    """Where a notification leads: {kind, number|sha|tag?, html_url}."""
    url = (subject or {}).get("url") or ""
    typ = (subject or {}).get("type") or ""
    m = re.search(r"/repos/[^/]+/[^/]+/(issues|pulls)/(\d+)$", url)
    if m:
        kind = "pull" if m.group(1) == "pulls" else "issue"
        n = int(m.group(2))
        return {"kind": kind, "number": n, "html_url": f"{WEB}/{repo}/{'pull' if kind == 'pull' else 'issues'}/{n}"}
    m = re.search(r"/repos/[^/]+/[^/]+/commits/([0-9a-f]{7,40})$", url)
    if m:
        return {"kind": "commit", "sha": m.group(1), "html_url": f"{WEB}/{repo}/commit/{m.group(1)}"}
    if typ == "Release" or "/releases/" in url:
        return {"kind": "release", "html_url": f"{WEB}/{repo}/releases"}
    if typ == "Discussion":
        return {"kind": "discussion", "html_url": f"{WEB}/{repo}/discussions"}
    if typ == "CheckSuite":
        return {"kind": "checks", "html_url": f"{WEB}/{repo}/actions"}
    return {"kind": "repo", "html_url": f"{WEB}/{repo}"}


def normalize_notification(n):
    repo_obj = n.get("repository") or {}
    repo_full = repo_obj.get("full_name") or ""
    subject = n.get("subject") or {}
    return {
        "id": str(n.get("id")),
        "unread": bool(n.get("unread")),
        "reason": n.get("reason"),
        "updated_at": _ts(n.get("updated_at")),
        "last_read_at": _ts(n.get("last_read_at")),
        "repo": repo_full,
        "repo_avatar": (repo_obj.get("owner") or {}).get("avatar_url"),
        "private": bool(repo_obj.get("private")),
        "title": subject.get("title") or "",
        "type": subject.get("type") or "",
        "target": notification_target(subject, repo_full),
    }


def notifications(show_all=False, participating=False, page=0):
    me = _need("notifications", "The inbox")
    params = {"per_page": 50, "page": page + 1, "all": str(bool(show_all)).lower(),
              "participating": str(bool(participating)).lower()}
    key = f"github:my:{me['login'].lower()}:notifs:{int(show_all)}{int(participating)}:{page}"
    data, has_next, stale = _cached(key, config.TTL_GITHUB_NOTIFS, "/notifications", params=params,
                                    shape=lambda d: [normalize_notification(n) for n in d or []])
    return {"items": data or [], "has_more": has_next, "stale": stale}


def notification_count():
    """Unread notifications (up to 50; `more` says there are others)."""
    me = account()
    if not me.get("linked") or not me["can"].get("notifications"):
        return {"available": False, "unread": 0}
    try:
        res = notifications()
    except GitHubError:
        return {"available": False, "unread": 0}
    unread = sum(1 for n in res["items"] if n["unread"])
    return {"available": True, "unread": unread, "more": res["has_more"]}


def _drop_inbox_cache():
    me = account()
    if me.get("linked"):
        cache.invalidate(f"github:my:{me['login'].lower()}:notifs:")


def mark_read(thread_id):
    _need("notifications", "Marking notifications")
    _api("PATCH", f"/notifications/threads/{int(thread_id)}")
    _drop_inbox_cache()


def mark_done(thread_id):
    _need("notifications", "Marking notifications")
    _api("DELETE", f"/notifications/threads/{int(thread_id)}")
    _drop_inbox_cache()


def mute(thread_id):
    _need("notifications", "Muting a thread")
    _api("PUT", f"/notifications/threads/{int(thread_id)}/subscription", json={"ignored": True})
    _drop_inbox_cache()


def mark_all_read(repo_full=None):
    _need("notifications", "Marking notifications")
    body = {"read": True, "last_read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    if repo_full:
        _api("PUT", f"/repos/{_split(repo_full)}/notifications", json=body)
    else:
        _api("PUT", "/notifications", json=body)
    _drop_inbox_cache()


# ── your work, stars, feed ───────────────────────────────────────────────────

WORK_QUERIES = {
    "review": "is:pr is:open review-requested:@me archived:false",
    "pulls": "is:pr is:open author:@me archived:false",
    "assigned": "is:open assignee:@me archived:false",
    "mentioned": "is:open mentions:@me archived:false",
}


def work():
    """Your open work across GitHub, four searches at once."""
    me = _me()

    def one(item):
        name, q = item
        data, _, _ = _cached(f"github:my:{me['login'].lower()}:work:{name}", config.TTL_GITHUB_WORK, "/search/issues",
                             params={"q": q, "sort": "updated", "order": "desc", "per_page": 25},
                             shape=lambda d: {"items": [normalize_issue(i) for i in (d or {}).get("items") or []],
                                              "total": (d or {}).get("total_count") or 0})
        return name, data

    out = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for name, data in ex.map(lambda it: _safe_one(one, it), WORK_QUERIES.items()):
            out[name] = data
    return out


def _safe_one(fn, item):
    try:
        return fn(item)
    except GitHubError as e:
        return item[0], {"items": [], "total": 0, "error": str(e)}


def my_repos(page=0, sort="pushed"):
    me = _me()
    sort = sort if sort in ("pushed", "updated", "created", "full_name") else "pushed"
    data, has_next, _ = _cached(
        f"github:my:{me['login'].lower()}:allrepos:{sort}:{page}", config.TTL_GITHUB_STARS, "/user/repos",
        params={"sort": sort, "per_page": PAGE_SIZE, "page": page + 1,
                "affiliation": "owner,collaborator,organization_member"},
        shape=lambda d: [normalize_repo(r) for r in d or []],
    )
    return {"items": data or [], "has_more": has_next}


def stars(page=0):
    me = _me()

    def shape(d):
        out = []
        for s in d or []:
            r = s.get("repo") if isinstance(s, dict) and "repo" in s else s
            it = normalize_repo(r)
            it["extra"]["starred_at"] = _ts(s.get("starred_at")) if isinstance(s, dict) else 0
            out.append(it)
        return out

    data, has_next, _ = _cached(f"github:my:{me['login'].lower()}:stars:{page}", config.TTL_GITHUB_STARS,
                                "/user/starred", params={"per_page": PAGE_SIZE * 2, "page": page + 1},
                                accept="application/vnd.github.star+json", shape=shape)
    return {"items": data or [], "has_more": has_next}


def received(page=0):
    """The GitHub dashboard feed: what the people you follow and the repos you
    watch have been doing."""
    me = _me()
    data, has_next, _ = _cached(
        f"github:my:{me['login'].lower()}:received:{page}", config.TTL_GITHUB_FEED,
        f"/users/{me['login']}/received_events", params={"per_page": 50, "page": page + 1},
        shape=lambda d: [normalize(e) for e in d or [] if e],
    )
    return {"items": data or [], "has_more": has_next}


def _yes_no(path):
    try:
        resp = _api("GET", path)
        return resp.status_code == 204
    except GitHubError as e:
        if e.kind == "not_found":
            return False
        raise


def viewer_state(full):
    """Do you star this repo? (None when no account is linked.)"""
    me = account()
    if not me.get("linked"):
        return {"starred": None}
    full = _split(full)
    key = f"github:my:{me['login'].lower()}:starred:{full.lower()}"
    data, _ = cache.cached(key, config.TTL_GITHUB_STARS, lambda: {"starred": _yes_no(f"/user/starred/{full}")})
    return data


def set_star(full, on):
    me = _need("star", "Starring")
    full = _split(full)
    _api("PUT" if on else "DELETE", f"/user/starred/{full}", headers={"Content-Length": "0"})
    cache.invalidate(f"github:my:{me['login'].lower()}:starred:{full.lower()}")
    cache.invalidate(f"github:my:{me['login'].lower()}:stars:")
    cache.invalidate(f"github:repo2:{full.lower()}")
    return {"starred": bool(on)}


def follow_state(login):
    me = account()
    if not me.get("linked"):
        return {"following": None}
    login = check_owner(login)
    key = f"github:my:{me['login'].lower()}:follows:{login.lower()}"
    data, _ = cache.cached(key, config.TTL_GITHUB_USER, lambda: {"following": _yes_no(f"/user/following/{login}")})
    return data


def set_follow(login, on):
    me = _need("follow", "Following people on GitHub")
    login = check_owner(login)
    _api("PUT" if on else "DELETE", f"/user/following/{login}", headers={"Content-Length": "0"})
    cache.invalidate(f"github:my:{me['login'].lower()}:follows:{login.lower()}")
    cache.invalidate(f"github:user:{login.lower()}")
    return {"following": bool(on)}


def add_comment(full, number, body):
    _need("comment", "Commenting")
    full = _split(full)
    body = (body or "").strip()
    if not body:
        raise GitHubError("Write something first.", 400, "invalid")
    if len(body) > 65000:
        raise GitHubError("That comment is longer than GitHub allows.", 400, "invalid")
    resp = _api("POST", f"/repos/{full}/issues/{int(number)}/comments", json={"body": body}, accept=_FULL)
    cache.invalidate(f"github:thread-comments:{full.lower()}#{int(number)}:")
    cache.invalidate(f"github:thread:{full.lower()}#{int(number)}")
    return _comment(resp.json())
