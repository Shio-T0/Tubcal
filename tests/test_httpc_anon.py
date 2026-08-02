"""Cookie containment for anonymous reads.

`httpc.session` is shared process-wide, so anything a host Set-Cookies is stored
and replayed on every later call to that host. Scraping a YouTube channel page
seeds VISITOR_INFO1_LIVE / YSC / __Secure-YNID — replaying those across search,
feeds and playback hands the platform one stable pseudonymous id spanning
everything the app does. `anonymous=True` routes through a jar that neither
stores nor sends.

The regression these tests exist to catch: a YouTube read quietly reverting to
the cookie-bearing session.
"""

import inspect

import pytest

from server import httpc
from server.sources import youtube


@pytest.fixture(autouse=True)
def _clear_jars():
    httpc.session.cookies.clear()
    httpc.anon_session.cookies.clear()
    yield
    httpc.session.cookies.clear()
    httpc.anon_session.cookies.clear()


class _Resp:
    status_code = 200
    headers = {}
    text = ""

    @staticmethod
    def raise_for_status():
        pass


def _capture(monkeypatch):
    """Record which session each request went through, and with what headers."""
    seen = []

    def make(name):
        def fake(url, headers=None, **kw):
            seen.append({"session": name, "url": url, "headers": headers or {}})
            return _Resp()
        return fake

    monkeypatch.setattr(httpc.session, "get", make("shared"))
    monkeypatch.setattr(httpc.anon_session, "get", make("anon"))
    return seen


def test_get_routes_to_the_requested_jar(monkeypatch):
    seen = _capture(monkeypatch)
    httpc.get("https://example.com/a")
    httpc.get("https://example.com/b", anonymous=True)
    assert [s["session"] for s in seen] == ["shared", "anon"]


def test_anon_policy_refuses_both_directions():
    policy = httpc.anon_session.cookies.get_policy()
    assert policy.set_ok(None, None) is False      # nothing stored from a response
    assert policy.return_ok(None, None) is False   # nothing replayed on a request


def test_explicit_cookie_header_survives_anonymous(monkeypatch):
    """Suppressing the *ambient* jar must not break the consent cookie — without
    SOCS, YouTube 302s channel pages to its consent interstitial and they never
    render."""
    seen = _capture(monkeypatch)
    httpc.get("https://www.youtube.com/channel/UCx",
              headers={"Cookie": youtube._CONSENT_COOKIE}, anonymous=True)
    assert seen[0]["headers"]["Cookie"] == youtube._CONSENT_COOKIE


@pytest.mark.parametrize("call,expected_anon", [
    ("fetch_channel_avatar",  True),   # channel page scrape — seeds the jar
    ("_channel_items",        True),   # subscription RSS
    ("_playlist_items_rss",   True),   # playlist RSS
    ("get_account_channel_ids", False),  # the user's OWN account — must stay authenticated
])
def test_youtube_call_sites_keep_their_intended_identity(call, expected_anon):
    """Read the source of each call site rather than exercising the network:
    what matters is that the `anonymous=` decision doesn't silently flip."""
    src = inspect.getsource(getattr(youtube, call))
    uses_anon = "anonymous=True" in src
    assert uses_anon is expected_anon, (
        f"{call}: anonymous={uses_anon}, expected {expected_anon}"
    )
    if not expected_anon:
        # The one authenticated call must still be sending the bearer token.
        assert "Authorization" in src


def test_no_youtube_read_uses_the_shared_jar():
    """Sweep youtube.py by AST: every httpc.get/post must be either anonymous or
    explicitly authenticated. A bare one silently rejoins the linkable session,
    and that's exactly the regression worth failing the build over."""
    import ast

    tree = ast.parse(inspect.getsource(youtube))
    offenders = []
    checked = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr in ("get", "post")):
            continue
        if not (isinstance(fn.value, ast.Name) and fn.value.id == "httpc"):
            continue
        checked += 1
        kw = {k.arg: k for k in node.keywords}
        anonymous = (
            "anonymous" in kw
            and isinstance(kw["anonymous"].value, ast.Constant)
            and kw["anonymous"].value.value is True
        )
        authenticated = "Authorization" in ast.dump(kw["headers"]) if "headers" in kw else False
        if not (anonymous or authenticated):
            offenders.append(node.lineno)

    assert checked >= 7, f"only found {checked} httpc call sites — did the module move?"
    assert not offenders, (
        f"youtube.py lines {offenders} call httpc without anonymous=True and "
        "without an Authorization header — they would replay the shared cookie jar"
    )
