"""Tests for GitHub source normalization — especially bookmark ID generation."""


def test_normalize_repo_with_id():
    """Normal repos from GitHub API have an 'id' field."""
    from server.sources.github import normalize

    raw = {
        "id": 123456,
        "name": "awesome-repo",
        "full_name": "octocat/awesome-repo",
        "html_url": "https://github.com/octocat/awesome-repo",
        "owner": {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
        "description": "An awesome repo",
        "language": "Python",
        "stargazers_count": 42,
        "forks_count": 7,
        "open_issues_count": 3,
        "topics": ["python", "awesome"],
        "created_at": "2023-01-01T00:00:00Z",
        "pushed_at": "2024-01-01T00:00:00Z",
    }
    item = normalize(raw)
    assert item is not None
    assert item["id"] == "github:repo:123456"
    assert item["platform"] == "github"
    assert item["title"] == "awesome-repo"
    assert item["source"] == "octocat/awesome-repo"
    assert item["extra"]["type"] == "repo"


def test_normalize_repo_without_id_uses_full_name():
    """If 'id' is missing/None, fall back to full_name so bookmarks still work."""
    from server.sources.github import normalize

    raw = {
        "name": "my-repo",
        "full_name": "user/my-repo",
        "html_url": "https://github.com/user/my-repo",
        "owner": {"login": "user", "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4"},
        "description": "A repo without an id field",
        "language": "Rust",
        "stargazers_count": 10,
        "forks_count": 2,
        "open_issues_count": 0,
        "topics": [],
        "created_at": "2023-06-01T00:00:00Z",
        "pushed_at": "2024-06-01T00:00:00Z",
    }
    item = normalize(raw)
    assert item is not None
    # Should fall back to full_name when id is missing
    assert item["id"] == "github:repo:user/my-repo"
    assert item["platform"] == "github"
    assert item["title"] == "my-repo"
    assert item["source"] == "user/my-repo"


def test_normalize_release_with_id():
    """Releases should use their id (or node_id) for bookmarking."""
    from server.sources.github import normalize

    raw = {
        "id": 999,
        "name": "v1.0.0",
        "tag_name": "v1.0.0",
        "html_url": "https://github.com/octocat/awesome-repo/releases/tag/v1.0.0",
        "url": "https://api.github.com/repos/octocat/awesome-repo/releases/999",
        "zipball_url": "https://api.github.com/repos/octocat/awesome-repo/zipball/v1.0.0",
        "owner": {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
        "published_at": "2024-01-15T00:00:00Z",
        "prerelease": False,
    }
    item = normalize(raw)
    assert item is not None
    assert item["id"] == "github:release:999"
    assert item["extra"]["type"] == "release"
    assert item["extra"]["tag"] == "v1.0.0"


def test_normalize_release_without_id_uses_repo_full_name():
    """If a release has no id, fall back to the repo full_name."""
    from server.sources.github import normalize

    raw = {
        "name": "v2.0.0",
        "tag_name": "v2.0.0",
        "html_url": "https://github.com/user/repo/releases/tag/v2.0.0",
        "url": "https://api.github.com/repos/user/repo/releases/",
        "zipball_url": "https://api.github.com/repos/user/repo/zipball/v2.0.0",
        "owner": {"login": "user", "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4"},
        "published_at": "2024-02-01T00:00:00Z",
        "prerelease": True,
    }
    item = normalize(raw)
    assert item is not None
    # Falls back to repo full_name extracted from url
    assert item["id"] == "github:release:user/repo"
    assert item["extra"]["type"] == "release"
    assert item["extra"]["tag"] == "v2.0.0"
    assert item["extra"]["prerelease"] is True


def test_normalize_event_with_id():
    """User events should use their id for bookmarking."""
    from server.sources.github import normalize

    raw = {
        "id": "evt-123",
        "type": "PushEvent",
        "actor": {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
        "repo": {"name": "octocat/awesome-repo"},
        "payload": {"commits": [{"message": "Fix bug"}], "size": 1, "ref": "refs/heads/main"},
        "created_at": "2024-03-01T00:00:00Z",
    }
    item = normalize(raw)
    assert item is not None
    assert item["id"] == "github:event:evt-123"
    assert item["extra"]["type"] == "event"
    assert item["extra"]["event_type"] == "PushEvent"


def test_normalize_event_without_id_uses_repo_name():
    """If an event has no id, fall back to repo name."""
    from server.sources.github import normalize

    raw = {
        "type": "WatchEvent",
        "actor": {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
        "repo": {"name": "octocat/another-repo"},
        "payload": {},
        "created_at": "2024-03-02T00:00:00Z",
    }
    item = normalize(raw)
    assert item is not None
    assert item["id"] == "github:event:octocat/another-repo"
    assert item["extra"]["type"] == "event"
    assert item["extra"]["event_type"] == "WatchEvent"


def test_normalize_event_without_id_or_repo_uses_event_type():
    """If an event has no id and no repo name, fall back to event_type."""
    from server.sources.github import normalize

    raw = {
        "type": "ForkEvent",
        "actor": {"login": "user", "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4"},
        "repo": {},
        "payload": {"forkee": {"full_name": "user/forked-repo"}},
        "created_at": "2024-03-03T00:00:00Z",
    }
    item = normalize(raw)
    assert item is not None
    assert item["id"] == "github:event:ForkEvent"
    assert item["extra"]["type"] == "event"
    assert item["extra"]["event_type"] == "ForkEvent"


def test_normalize_empty_item_returns_none():
    """None or empty input should return None."""
    from server.sources.github import normalize

    assert normalize(None) is None
    assert normalize({}) is None