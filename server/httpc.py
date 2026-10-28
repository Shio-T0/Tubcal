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
import ipaddress
import socket
import sys
import threading
import time
from socket import timeout as SocketTimeout
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import connection as u3connection
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NameResolutionError, NewConnectionError

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


# ── public addresses only ─────────────────────────────────────────────────────
# Some fetches go wherever a third party says: the anime proxies follow the URIs
# in a source's playlists. A playlist naming 127.0.0.1 or a router's address would
# otherwise have this server fetch from inside the network. `public_session`
# checks at the moment it connects: the host is resolved, every address must be a
# public one, and the socket goes to an address that was checked, so a name that
# answers differently the second time can't steer it inside. Redirect hops open
# their own connections and are checked the same way. No cookies either way.
# A request through the user's own proxy is left to the proxy (it does the lookup).

class NotPublic(OSError):
    """The host resolves to this machine, the local network or a reserved range."""


def public(address):
    """A public address: not this machine, the local network, link-local, multicast or
    reserved (an IPv4 address written as IPv6 is judged as the IPv4 one)."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _resolve(host, port):
    """(family, address) for every address `host` resolves to (a seam for the tests)."""
    return [(info[0], info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


class _PublicConnect:
    def _new_conn(self):
        try:
            addrs = list(dict.fromkeys(_resolve(self._dns_host, self.port)))
        except socket.gaierror as e:
            raise NameResolutionError(self.host, self, e) from e
        if not addrs or not all(public(a) for _, a in addrs):
            raise NotPublic(f"{self.host} is on this machine or the local network")
        last = None
        for _, addr in addrs:
            try:
                sock = u3connection.create_connection((addr, self.port), self.timeout,
                                                      source_address=self.source_address,
                                                      socket_options=self.socket_options)
            except SocketTimeout as e:
                last = ConnectTimeoutError(self, f"Connection to {self.host} timed out.")
                last.__cause__ = e
            except OSError as e:
                last = NewConnectionError(self, f"Failed to establish a new connection: {e}")
                last.__cause__ = e
            else:
                sys.audit("http.client.connect", self, self.host, self.port)
                return sock
        raise last


class _PublicHTTPConnection(_PublicConnect, HTTPConnection):
    pass


class _PublicHTTPSConnection(_PublicConnect, HTTPSConnection):
    pass


class _PublicHTTPPool(HTTPConnectionPool):
    ConnectionCls = _PublicHTTPConnection


class _PublicHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _PublicHTTPSConnection


class _PublicAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {"http": _PublicHTTPPool, "https": _PublicHTTPSPool}


public_session = requests.Session()
_public_adapter = _PublicAdapter(pool_connections=32, pool_maxsize=64)
public_session.mount("https://", _public_adapter)
public_session.mount("http://", _public_adapter)
public_session.cookies.set_policy(_BlockCookies())


def refused(exc):
    """Whether a failed request was stopped by `public_session`'s address check."""
    seen, stack = set(), [exc]
    while stack:
        e = stack.pop()
        if e is None or id(e) in seen:
            continue
        seen.add(id(e))
        if isinstance(e, NotPublic):
            return True
        stack += [getattr(e, "reason", None), e.__cause__, e.__context__]
        stack += [a for a in getattr(e, "args", ()) if isinstance(a, BaseException)]
    return False


def _session_for(anonymous, public_only):
    return public_session if public_only else anon_session if anonymous else session


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
                # Reddit sends seconds to wait; GitHub sends the epoch second the
                # window reopens. Read a big number as a clock time, or a GitHub
                # reset would block the host for half a century.
                wait = float(reset)
                if wait > 1e9:
                    wait = max(0.0, wait - now)
                with _registry_lock:
                    _host_blocked_until[host] = now + wait
        except ValueError:
            pass


def get(url, *, ua=config.BROWSER_UA, headers=None, timeout=15, anonymous=False, host_limits=True,
        public_only=False, **kwargs):
    """GET via the shared session. `anonymous=True` routes through a jar that
    neither sends nor stores cookies — see `anon_session`. An explicit `Cookie`
    header still goes out (the YouTube consent cookie relies on that); what's
    suppressed is the *ambient* jar, in both directions.

    `host_limits=False` is for a caller that keeps its own rate-limit books
    (GitHub, whose budgets are per bucket — core, search, graphql — not per
    host): its responses never block the host here.

    `public_only=True` is for an address a third party chose: see `public_session`."""
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)
    sess = _session_for(anonymous, public_only)

    host = urlparse(url).hostname or ""

    # Short-circuit instantly if we already know this host is out of budget —
    # don't burn the request (or a thread) finding that out again.
    blocked_until = _host_blocked_until.get(host) if host_limits else None
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

    if host_limits:
        _note_rate_limit(host, resp)
        if resp.status_code == 429:
            blocked_until = _host_blocked_until.get(host, time.time() + 30)
            raise RateLimited(host, blocked_until - time.time())

    resp.raise_for_status()
    return resp


def request(method, url, *, ua=config.BROWSER_UA, headers=None, timeout=15, anonymous=False, **kwargs):
    """Any other verb (PUT, PATCH, DELETE) via the shared session, for the writes
    a linked account makes. Same cookie rule as `get`; no host spacing, since a
    write is one deliberate click, not a crawl."""
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)
    sess = anon_session if anonymous else session
    resp = sess.request(method, url, headers=hdrs, timeout=timeout, **kwargs)
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


def stream_get(url, *, headers=None, anonymous=False, public_only=False, timeout=(6, 25), attempts=4,
               refresh=None):
    """Open a streaming GET for media bytes, riding out what usually goes wrong
    mid-video instead of handing the first failure to the player.

    Connection errors, timeouts and the CDN's 5xx/429 are retried with a short
    backoff. When the server refuses the URL itself (403/404/410), `refresh(url)`
    may supply a replacement — a freshly resolved URL for the *same file*, so a
    byte range carries over unchanged — and that is tried instead (once).

    Returns the last response (the caller relays its status, error or not), or
    raises the last connection error if no attempt got a response at all. An
    address `public_only` refuses is raised at once (`refused(e)` says so)."""
    sess = _session_for(anonymous, public_only)
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", config.BROWSER_UA)
    resp = None
    last_exc = None
    refreshed = False
    tries = 0
    while tries < attempts:
        if resp is not None:
            resp.close()
            resp = None
        tries += 1
        last = tries >= attempts
        try:
            resp = sess.get(url, headers=hdrs, stream=True, timeout=timeout, allow_redirects=True)
        except requests.RequestException as e:
            if refused(e):
                raise
            last_exc = e
            if not last:
                time.sleep(min(2.0, 0.3 * 2 ** (tries - 1)))
            continue
        if resp.status_code in _STALE_STATUS and refresh and not refreshed:
            refreshed = True
            fresh = refresh(url)
            if fresh and fresh != url:
                # A new URL is a fresh start, not a retry: even a refusal on the
                # final attempt still gets its one go at the replacement.
                url = fresh
                tries = min(tries, attempts - 1)
                continue
            return resp
        if resp.status_code in _RETRY_STATUS and not last:
            time.sleep(min(2.0, 0.3 * 2 ** (tries - 1)))
            continue
        return resp
    if resp is not None:
        return resp
    raise last_exc or requests.ConnectionError(f"no response from {urlparse(url).hostname}")
