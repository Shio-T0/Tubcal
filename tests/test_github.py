"""The GitHub room: page parsers, normalizers, the budget, account linking and
the workspace's clones. The network edge (`github._api`, `httpc.get`) is
monkeypatched, so nothing here talks to GitHub."""

import json
import subprocess

import pytest
import requests

TRENDING_ROW = """
<article class="Box-row">
  <div class="float-right d-flex"><a href="/login?return_to=%2Fastral-sh%2Fuv"
     data-hydro-click="{&quot;repository_id&quot;:699532645}">Star</a></div>
  <h2 class="h3 lh-condensed">
    <a data-hydro-click="{}" href="/astral-sh/uv" data-view-component="true" class="Link"><svg></svg>
      <span data-view-component="true" class="text-normal">astral-sh /</span>
      uv</a>  </h2>
    <p class="col-9 color-fg-muted my-1 tmp-pr-4">
      An extremely fast Python package &amp; project manager, written in Rust.
    </p>
  <div class="f6 color-fg-muted mt-2">
      <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0">
  <span class="repo-language-color" style="background-color: #dea584"></span>
  <span itemprop="programmingLanguage">Rust</span>
</span>
      <a href="/astral-sh/uv/stargazers" class="Link"><svg aria-hidden="true"><path d="M8"></path></svg>
        90,905</a>
      <a href="/astral-sh/uv/forks" class="Link"><svg><path></path></svg>
        3,669</a>
      <span class="tmp-mr-3 d-inline-block">Built by
          <a class="d-inline-block" href="/charliermarsh"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/1309177?s=40&amp;v=4" width="20" height="20" alt="@charliermarsh" /></a>
</span>
      <span class="d-inline-block float-sm-right"><svg></svg>
        1,234 stars today
</span>  </div>
</article>
"""

DEV_ROW = """
<article class="Box-row d-flex" id="pa-BurntSushi">
  <div class="tmp-mx-3"><a href="/BurntSushi" class="Link"><img class="rounded avatar-user" src="https://avatars.githubusercontent.com/u/456674?s=96&amp;v=4" width="48" height="48" alt="@BurntSushi" /></a></div>
        <h1 class="h3 lh-condensed" >
          <a   href="/BurntSushi" class="Link">Andrew Gallant</a>        </h1>
  <article>
  <div class="f6 color-fg-muted text-uppercase mb-1"><svg></svg>Popular repo</div>
  <h1 class="h4 lh-condensed"><a href="/BurntSushi/ripgrep" class="Link"><svg></svg> ripgrep</a></h1>
    <div class="f6 color-fg-muted mt-1">
      ripgrep recursively searches directories
    </div>
</article>
</article>
"""

CONTRIB = """
<h2 class="f4 text-normal mb-2">
      3,743
      contributions
        in the last year
</h2>
<td tabindex="0" data-ix="0" style="width: 10px" data-date="2025-10-20" id="contribution-day-component-1-0" data-level="0" class="ContributionCalendar-day"></td>
<tool-tip id="t1" for="contribution-day-component-1-0" popover="manual" class="sr-only">No contributions on October 20th.</tool-tip>
<td tabindex="0" data-ix="0" style="width: 10px" data-date="2025-10-19" id="contribution-day-component-0-0" data-level="2" class="ContributionCalendar-day"></td>
<tool-tip id="t0" for="contribution-day-component-0-0" popover="manual" class="sr-only">1,204 contributions on October 19th.</tool-tip>
"""

ATOM_COMMITS = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <entry>
    <id>tag:github.com,2008:Grit::Commit/deba0cbdc329d0a6cd118d5e1d58a203df08c0d3</id>
    <link type="text/html" rel="alternate" href="https://github.com/astral-sh/uv/commit/deba0cbdc329d0a6cd118d5e1d58a203df08c0d3"/>
    <title>
        Centralize index construction (#22734)
    </title>
    <updated>2026-10-19T16:57:20Z</updated>
    <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/6826232?s=30&amp;v=4"/>
    <author><name>konstin</name><uri>https://github.com/konstin</uri></author>
    <content type="html">&lt;pre&gt;Centralize index construction (#22734)

Move some code around.&lt;/pre&gt;</content>
  </entry>
</feed>"""

ATOM_RELEASES = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <id>tag:github.com,2008:Repository/699532645/0.13.1</id>
    <updated>2026-10-14T05:15:30Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/astral-sh/uv/releases/tag/0.13.1"/>
    <title>0.13.1</title>
    <content type="html">&lt;h2&gt;Release Notes&lt;/h2&gt;</content>
    <author><name>github-actions[bot]</name></author>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/699532645/v2.0.0-rc.1</id>
    <updated>2026-10-10T05:15:30Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/astral-sh/uv/releases/tag/v2.0.0-rc.1"/>
    <title>v2.0.0-rc.1</title>
    <content type="html"></content>
  </entry>
</feed>"""


class FakeResp:
    def __init__(self, status=200, body=None, headers=None, text=None, links=None):
        self.status_code = status
        self._body = body
        self.headers = requests.structures.CaseInsensitiveDict(headers or {})
        self.text = text if text is not None else json.dumps(body)
        self.content = self.text.encode()
        self.links = links or {}

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


# ── page parsers ─────────────────────────────────────────────────────────────

def test_parse_trending_reads_repo_numbers_and_stars_gained():
    from server.sources.github import parse_trending

    [item] = parse_trending("<html>" + TRENDING_ROW + "</html>")
    assert item["id"] == "github:repo:astral-sh/uv"
    assert item["source"] == "astral-sh/uv"
    assert item["title"] == "uv"
    x = item["extra"]
    assert x["description"] == "An extremely fast Python package & project manager, written in Rust."
    assert x["language"] == "Rust" and x["lang_color"] == "#dea584"
    assert x["stars"] == 90905 and x["forks"] == 3669
    assert x["stars_gained"] == 1234
    assert x["built_by"] == [{"login": "charliermarsh",
                              "avatar": "https://avatars.githubusercontent.com/u/1309177?s=40&v=4"}]


def test_parse_trending_developers():
    from server.sources.github import parse_trending_developers

    [dev] = parse_trending_developers(DEV_ROW)
    assert dev["login"] == "BurntSushi"
    assert dev["name"] == "Andrew Gallant"
    assert dev["repo"] == "BurntSushi/ripgrep"
    assert dev["repo_description"] == "ripgrep recursively searches directories"


def test_parse_contributions_orders_days_and_reads_counts():
    from server.sources.github import parse_contributions

    cal = parse_contributions(CONTRIB)
    assert cal["total"] == 3743
    assert cal["days"] == [
        {"date": "2025-10-19", "count": 1204, "level": 2},
        {"date": "2025-10-20", "count": 0, "level": 0},
    ]


def test_atom_commits_and_releases_become_feed_items():
    from server.sources.github import _atom_commits, _atom_releases, parse_atom

    [c] = _atom_commits("astral-sh/uv", parse_atom(ATOM_COMMITS))
    assert c["id"] == "github:commit:astral-sh/uv@deba0cbdc329d0a6cd118d5e1d58a203df08c0d3"
    assert c["title"] == "Centralize index construction (#22734)"
    assert c["author"] == "konstin"
    assert c["extra"]["short"] == "deba0cb"
    assert c["extra"]["body"] == "Move some code around."
    rels = _atom_releases("astral-sh/uv", parse_atom(ATOM_RELEASES))
    assert [r["extra"]["tag"] for r in rels] == ["0.13.1", "v2.0.0-rc.1"]
    assert rels[0]["id"] == "github:release:astral-sh/uv@0.13.1"
    assert rels[0]["extra"]["notes_html"] == "<h2>Release Notes</h2>"
    assert [r["extra"]["prerelease"] for r in rels] == [False, True]


# ── normalizers ──────────────────────────────────────────────────────────────

def test_normalize_issue_reads_merged_pull_requests():
    from server.sources.github import normalize_issue

    raw = {
        "number": 7, "title": "Speed up", "state": "closed", "html_url": "https://github.com/o/r/pull/7",
        "repository_url": "https://api.github.com/repos/o/r", "comments": 0,
        "user": {"login": "ann", "avatar_url": "a.png"},
        "created_at": "2026-10-01T00:00:00Z", "closed_at": "2026-10-02T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z",
        "pull_request": {"merged_at": "2026-10-02T00:00:00Z"},
        "labels": [{"name": "perf", "color": "FBCA04"}],
    }
    item = normalize_issue(raw)
    assert item["id"] == "github:pull:o/r#7"
    assert item["source"] == "o/r"
    x = item["extra"]
    assert x["kind"] == "pull" and x["state"] == "merged" and x["action"] == "merged"
    assert x["labels"] == [{"name": "perf", "color": "fbca04"}]


def test_normalize_issue_marks_a_discussed_issue():
    from server.sources.github import normalize_issue

    raw = {"number": 3, "title": "Bug", "state": "open", "comments": 4,
           "html_url": "https://github.com/o/r/issues/3",
           "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-05T00:00:00Z"}
    item = normalize_issue(raw, "o/r")
    assert item["id"] == "github:issue:o/r#3"
    assert item["extra"]["action"] == "discussed"
    assert item["published_at"] == item["extra"]["updated_at"]


def test_trimmed_push_and_pull_request_events_still_read_well():
    """GitHub's 2025 payloads drop a push's commits and a PR's title."""
    from server.sources.github import normalize

    push = normalize({"id": "1", "type": "PushEvent", "actor": {"login": "x"}, "repo": {"name": "o/r"},
                      "payload": {"ref": "refs/heads/main", "head": "f448faef39ac93cf", "before": "c4eef1fa788ba214"},
                      "created_at": "2026-10-19T00:00:00Z"})
    assert push["extra"]["text"] == "Pushed to main"
    assert push["url"] == "https://github.com/o/r/compare/c4eef1fa788b...f448faef39ac"
    assert push["title"] == "[o/r] Pushed to main"
    pr = normalize({"id": "2", "type": "PullRequestEvent", "actor": {"login": "x"}, "repo": {"name": "o/r"},
                    "payload": {"action": "merged", "number": 12, "pull_request": {"number": 12}},
                    "created_at": "2026-10-19T00:00:00Z"})
    assert pr["extra"]["text"] == "Merged pull request #12"
    assert pr["extra"]["number"] == 12 and pr["extra"]["link"] == "pull"
    assert pr["url"] == "https://github.com/o/r/pull/12"


def test_notification_targets():
    from server.sources.github import notification_target as t

    assert t({"url": "https://api.github.com/repos/o/r/pulls/5", "type": "PullRequest"}, "o/r") == {
        "kind": "pull", "number": 5, "html_url": "https://github.com/o/r/pull/5"}
    assert t({"url": "https://api.github.com/repos/o/r/issues/9", "type": "Issue"}, "o/r")["kind"] == "issue"
    assert t({"url": "https://api.github.com/repos/o/r/commits/abcdef1", "type": "Commit"}, "o/r")["sha"] == "abcdef1"
    assert t({"url": None, "type": "Discussion"}, "o/r")["kind"] == "discussion"
    assert t({"url": None, "type": "CheckSuite"}, "o/r")["html_url"] == "https://github.com/o/r/actions"


def test_capabilities_follow_the_scopes():
    from server.sources.github import capabilities

    gh = capabilities(["gist", "read:org", "repo"], "gho_x")
    assert gh["notifications"] and gh["star"] and gh["comment"] and gh["private"]
    assert not gh["follow"]
    public = capabilities(["public_repo", "user:follow"], "ghp_x")
    assert public["star"] and public["follow"] and not public["private"] and not public["notifications"]
    fine = capabilities(None, "github_pat_x")
    assert fine["fine_grained"] and not fine["notifications"] and fine["star"]


def test_names_are_checked_before_any_request():
    from server.sources.github import GitHubError, check_repo, _clean_path

    assert check_repo("astral-sh", "uv") == "astral-sh/uv"
    for owner, name in [("a/b", "c"), ("-bad", "x"), ("ok", ".."), ("ok", "a b")]:
        with pytest.raises(GitHubError):
            check_repo(owner, name)
    assert _clean_path("/crates//uv/") == "crates/uv"
    with pytest.raises(GitHubError):
        _clean_path("crates/../../etc")


# ── the transport ────────────────────────────────────────────────────────────

def test_budget_headers_and_an_empty_bucket_fail_fast(monkeypatch):
    from server import httpc
    from server.sources import github

    monkeypatch.setattr(github, "_token", lambda: None)
    github._empty_until.clear()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        resp = FakeResp(403, {"message": "API rate limit exceeded for 1.2.3.4."},
                        {"X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "0",
                         "X-RateLimit-Reset": "4102444800", "X-RateLimit-Resource": "core"})
        err = requests.HTTPError("403")
        err.response = resp
        raise err

    monkeypatch.setattr(httpc, "get", fake_get)
    with pytest.raises(github.GitHubError) as e:
        github._api("GET", "/repos/o/r")
    assert e.value.kind == "rate_limit" and e.value.status == 429
    assert "Link an account" in str(e.value)
    with pytest.raises(github.GitHubError):
        github._api("GET", "/repos/o/r")  # no second request while the bucket is empty
    assert len(calls) == 1
    assert github._budget["core"]["remaining"] == 0
    github._empty_until.clear()


@pytest.fixture
def gh_db(client):
    """The app's throwaway DB (via the client fixture) plus a clean cache."""
    from server import cache
    cache.invalidate("github:")
    yield client
    cache.invalidate("github:")


def test_cached_get_revalidates_with_its_etag(gh_db, monkeypatch):
    from server.sources import github

    seen = []

    def fake_api(method, path, **kw):
        seen.append(kw.get("headers") or {})
        if len(seen) == 1:
            return FakeResp(200, [{"name": "main"}], {"ETag": '"abc"'})
        return FakeResp(304, None, {"ETag": '"abc"'}, text="")

    monkeypatch.setattr(github, "_api", fake_api)
    data, _, _ = github._cached("github:test:etag", 0, "/x")
    assert data == [{"name": "main"}]
    data, _, _ = github._cached("github:test:etag", 0, "/x")
    assert data == [{"name": "main"}]
    assert seen[1] == {"If-None-Match": '"abc"'}


# ── linking an account ───────────────────────────────────────────────────────

def test_link_token_stores_it_and_reports_the_account(gh_db, monkeypatch):
    from server import db
    from server.sources import github

    monkeypatch.delenv("TUBCAL_GITHUB_TOKEN", raising=False)

    def fake_api(method, path, token=True, **kw):
        assert path == "/user"
        return FakeResp(200, {"login": "shio", "name": "Shio", "avatar_url": "a.png"},
                        {"X-OAuth-Scopes": "repo, notifications"})

    monkeypatch.setattr(github, "_api", fake_api)
    r = gh_db.post("/api/github/account", json={"token": "ghp_" + "a" * 36})
    body = r.get_json()
    assert body["ok"], body
    assert body["data"]["linked"] and body["data"]["login"] == "shio"
    assert body["data"]["can"]["notifications"] and body["data"]["source"] == "token"
    assert db.get_oauth("github")["access_token"] == "ghp_" + "a" * 36
    # The token itself never comes back to the page.
    assert "ghp_" not in json.dumps(gh_db.get("/api/github/account").get_json())
    r = gh_db.delete("/api/github/account", json={})
    assert r.get_json()["data"]["linked"] is False
    assert db.get_oauth("github") is None


def test_link_rejects_junk_and_refused_tokens(gh_db, monkeypatch):
    from server.sources import github

    r = gh_db.post("/api/github/account", json={"token": "not a token"})
    assert r.status_code == 400
    def refused(method, path, **kw):
        raise github.GitHubError("GitHub refused the linked token.", 401, "auth")
    monkeypatch.setattr(github, "_api", refused)
    r = gh_db.post("/api/github/account", json={"token": "ghp_" + "b" * 36})
    assert r.status_code == 401 and r.get_json()["ok"] is False


def test_account_only_features_say_how_to_unlock(gh_db, monkeypatch):
    from server.sources import github

    monkeypatch.setattr(github, "_token", lambda: None)
    r = gh_db.get("/api/github/inbox")
    assert r.status_code == 401
    assert "Settings → Accounts" in r.get_json()["error"]
    assert gh_db.get("/api/github/inbox/count").get_json()["data"] == {"available": False, "unread": 0}
    r = gh_db.get("/api/github/search?q=fn+main&in=code")
    assert r.status_code == 401


def test_follow_without_the_scope_is_refused_before_github_is_asked(gh_db, monkeypatch):
    from server.sources import github

    monkeypatch.setattr(github, "account", lambda: {"linked": True, "login": "shio",
                                                    "can": github.capabilities(["repo"], "gho_x")})
    def no_call(*a, **kw):
        raise AssertionError("GitHub should not be asked")
    monkeypatch.setattr(github, "_api", no_call)
    r = gh_db.put("/api/github/user/octocat/follow", json={})
    assert r.status_code == 403
    assert "user:follow" in r.get_json()["error"]


def test_trending_falls_back_to_search_when_the_page_cannot_be_read(gh_db, monkeypatch):
    from server import httpc
    from server.sources import github

    def broken(url, **kw):
        raise requests.ConnectionError("down")
    monkeypatch.setattr(httpc, "get", broken)
    monkeypatch.setattr(github, "_api", lambda method, path, **kw: FakeResp(200, {"items": [
        {"full_name": "o/r", "name": "r", "owner": {"login": "o"}, "stargazers_count": 5}]}))
    res = github.trending("weekly", "Rust")
    assert res["source"] == "search"
    assert res["items"][0]["source"] == "o/r"


# ── the workspace ────────────────────────────────────────────────────────────

def test_parse_remote_urls():
    from server.sources.github_local import parse_remote

    assert parse_remote("https://github.com/Shio-T0/Tubcal.git") == "Shio-T0/Tubcal"
    assert parse_remote("git@github.com:astral-sh/uv.git") == "astral-sh/uv"
    assert parse_remote("ssh://git@github.com:22/o/r") == "o/r"
    assert parse_remote("https://user:tok@github.com/o/r.js/") == "o/r.js"
    assert parse_remote("https://gitlab.com/o/r.git") is None


def test_parse_branch_line():
    from server.sources.github_local import parse_branch_line as p

    assert p("## main...origin/main [ahead 1, behind 2]") == {
        "branch": "main", "upstream": "origin/main", "ahead": 1, "behind": 2, "gone": False, "detached": False}
    assert p("## feature")["upstream"] is None
    assert p("## topic...origin/topic [gone]")["gone"] is True
    assert p("## HEAD (no branch)")["detached"] is True
    assert p("## No commits yet on main")["branch"] == "main"


def _git_ok():
    try:
        return subprocess.run(["git", "--version"], capture_output=True).returncode == 0
    except OSError:
        return False


@pytest.mark.skipif(not _git_ok(), reason="git not installed")
def test_clones_are_found_and_named_destinations_stay_inside(tmp_path, monkeypatch):
    from server import config
    from server.sources import github, github_local

    monkeypatch.setattr(config, "EDITOR_ROOT", tmp_path.resolve())
    github_local._scan.update(at=0, items=None)
    repo = tmp_path / "uv"
    repo.mkdir()
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    run = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True,  # noqa: E731
                                    env={**__import__("os").environ, **env})
    run("init", "-q", "-b", "main")
    (repo / "README.md").write_text("hi\n")
    run("add", "README.md")
    run("commit", "-qm", "first")
    run("remote", "add", "origin", "git@github.com:astral-sh/uv.git")
    (repo / "README.md").write_text("changed\n")
    (tmp_path / "plain").mkdir()  # not a repo: ignored

    [c] = github_local.clones(force=True)
    assert c["repo"] == "astral-sh/uv" and c["path"] == "uv" and c["branch"] == "main"
    assert c["changed"] == 1 and c["subject"] == "first"
    assert github_local.find("Astral-SH/UV")["path"] == "uv"
    # A second clone of another owner's uv goes beside it, never outside the root.
    assert github_local.destination("someone/uv") == (tmp_path / "uv-someone").resolve()
    with pytest.raises(github.GitHubError):
        github_local.destination("someone/..")
    started = github_local.start_clone("astral-sh/uv")
    assert started["state"] == "exists" and started["open"] == "uv/README.md"


def test_writes_must_be_json_so_other_sites_cannot_forge_them(gh_db, monkeypatch):
    """A cross-site form or text/plain POST can't reach the account's writes."""
    from server.sources import github

    def no_call(*a, **kw):
        raise AssertionError("GitHub should not be asked")
    monkeypatch.setattr(github, "_api", no_call)
    r = gh_db.post("/api/github/repo/o/r/thread/1/comments", data='{"body": "spam"}', content_type="text/plain")
    assert r.status_code == 415
    r = gh_db.post("/api/github/account", data="method=gh", content_type="application/x-www-form-urlencoded")
    assert r.status_code == 415
    assert gh_db.get("/api/github/budget").status_code == 200
