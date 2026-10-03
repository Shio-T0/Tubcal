"""Shared HTTP client: one requests.Session, per-host minimum spacing."""

"""Shared HTTP client: one requests.Session, per-host minimum spacing, and
dynamic rate-limit tracking driven by response headers (e.g. Reddit's
x-ratelimit-remaining/x-ratelimit-reset).

Reddit's anonymous RSS endpoint has a very tight budget — it commonly comes
back with x-ratelimit-remaining: 0 after a SINGLE request, resetting only
after tens of seconds. A fixed 3s spacing (HOST_INTERVALS) doesn't come
close to respecting that, so callers were getting silent 429s that got
misreported as "not found". Instead of guessing a static interval, we read
the limiter's own headers and remember when a host is next available.
"""

import http.cookiejar
import threading
import time
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter

from . import config

session = requests.Session()
# The default urllib3 pool caps each host at 10 connections. Proxying an HLS
# rendition fans out into many concurrent segment fetches to the same googlevideo
# host (plus the held-open streaming relays), which blew past 10 and forced
# connections to be discarded/rebuilt mid-playback — a real source of stutter.
# A roomier pool lets segments load in parallel without churn.
_adapter = HTTPAdapter(pool_connections=32, pool_maxsize=64)
session.mount("https://", _adapter)
session.mount("http://", _adapter)


class _BlockCookies(http.cookiejar.DefaultCookiePolicy):
    """A cookie policy that refuses to store or send anything."""

    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


# `session` is shared, so its jar accumulates whatever a host sets — scraping a
# YouTube channel page seeds VISITOR_INFO1_LIVE / YSC / __Secure-YNID, and
# requests then merges those into *every* later call to that host. For an
# anonymous read that's a linkability leak: it hands the platform one stable
# pseudonymous id spanning searches, feeds and playback. `anon_session` carries
# the same pooling but a jar that neither stores nor sends, so a request made
# through it stays unlinkable to the rest of the session.
anon_session = requests.Session()
anon_session.mount("https://", _adapter)
anon_session.mount("http://", _adapter)
anon_session.cookies.set_policy(_BlockCookies())

_host_locks = {}
_host_last = {}
_host_blocked_until = {}
_registry_lock = threading.Lock()


class RateLimited(Exception):
    """Raised when a host has told us (via headers, past or present) that we're
    out of budget. `retry_after` is seconds until it's safe to try again."""

    def __init__(self, host, retry_after):
        self.host = host
        self.retry_after = max(0, retry_after)
        super().__init__(f"{host} rate-limited us — retry in {self.retry_after:.0f}s")


def _note_rate_limit(host, resp):
    """Read rate-limit headers (Reddit-style x-ratelimit-*, or a plain
    Retry-After on 429) and remember when this host is next usable."""
    now = time.time()
    retry_after = resp.headers.get("Retry-After")
    if retry_after is not None:
        try:
            with _registry_lock:
                _host_blocked_until[host] = now + float(retry_after)
            return
        except ValueError:
            pass

    remaining = resp.headers.get("x-ratelimit-remaining")
    reset = resp.headers.get("x-ratelimit-reset")
    if remaining is not None and reset is not None:
        try:
            if float(remaining) <= 0:
                with _registry_lock:
                    _host_blocked_until[host] = now + float(reset)
        except ValueError:
            pass


def get(url, *, ua=config.BROWSER_UA, headers=None, timeout=15, anonymous=False, **kwargs):
    """GET via the shared session. `anonymous=True` routes through a jar that
    neither sends nor stores cookies — see `anon_session`. An explicit `Cookie`
    header still goes out (the YouTube consent cookie relies on that); what's
    suppressed is the *ambient* jar, in both directions."""
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)
    sess = anon_session if anonymous else session

    host = urlparse(url).hostname or ""

    # Short-circuit instantly if we already know this host is out of budget —
    # don't burn the request (or a thread) finding that out again.
    blocked_until = _host_blocked_until.get(host)
    if blocked_until and time.time() < blocked_until:
        raise RateLimited(host, blocked_until - time.time())

    interval = config.HOST_INTERVALS.get(host)
    if interval:
        with _registry_lock:
            lock = _host_locks.setdefault(host, threading.Lock())
        with lock:
            wait = _host_last.get(host, 0) + interval - time.time()
            if wait > 0:
                time.sleep(wait)
            _host_last[host] = time.time()
            resp = sess.get(url, headers=hdrs, timeout=timeout, **kwargs)
    else:
        resp = sess.get(url, headers=hdrs, timeout=timeout, **kwargs)

    _note_rate_limit(host, resp)

    if resp.status_code == 429:
        blocked_until = _host_blocked_until.get(host, time.time() + 30)
        raise RateLimited(host, blocked_until - time.time())

    resp.raise_for_status()
    return resp


def post(url, *, ua=config.BROWSER_UA, headers=None, timeout=15, anonymous=False, **kwargs):
    """POST via the shared session. `anonymous=True` routes through a jar that
    neither sends nor stores cookies — use it for unauthenticated reads that
    shouldn't be linkable to the rest of this process's traffic."""
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)
    sess = anon_session if anonymous else session
    resp = sess.post(url, headers=hdrs, timeout=timeout, **kwargs)
    resp.raise_for_status()
    return resp


# ── media bytes ───────────────────────────────────────────────────────────────

# The CDN's own hiccups: worth another try at the same URL.
_RETRY_STATUS = {408, 429, 500, 502, 503, 504}
# The CDN refusing the URL itself — expired, or (googlevideo) minted for an IP
# this machine no longer has. Retrying the same URL won't help; a fresh one will.
_STALE_STATUS = {401, 403, 404, 410}


def stream_get(url, *, headers=None, anonymous=False, timeout=(6, 25), attempts=4, refresh=None):
    """Open a streaming GET for media bytes, riding out what usually goes wrong
    mid-video instead of handing the first failure to the player.

    Connection errors, timeouts and the CDN's 5xx/429 are retried with a short
    backoff. When the server refuses the URL itself (403/404/410), `refresh(url)`
    may supply a replacement — a freshly resolved URL for the *same file*, so a
    byte range carries over unchanged — and that is tried instead (once).

    Returns the last response (the caller relays its status, error or not), or
    raises the last connection error if no attempt got a response at all."""
    sess = anon_session if anonymous else session
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", config.BROWSER_UA)
    resp = None
    last_exc = None
    refreshed = False
    for i in range(attempts):
        if resp is not None:
            resp.close()
            resp = None
        try:
            resp = sess.get(url, headers=hdrs, stream=True, timeout=timeout, allow_redirects=True)
        except requests.RequestException as e:
            last_exc = e
            if i < attempts - 1:
                time.sleep(min(2.0, 0.3 * 2 ** i))
            continue
        if resp.status_code in _STALE_STATUS and refresh and not refreshed:
            refreshed = True
            fresh = refresh(url)
            if fresh and fresh != url:
                url = fresh
                continue
            return resp
        if resp.status_code in _RETRY_STATUS and i < attempts - 1:
            time.sleep(min(2.0, 0.3 * 2 ** i))
            continue
        return resp
    if resp is not None:
        return resp
    raise last_exc or requests.ConnectionError(f"no response from {urlparse(url).hostname}")
