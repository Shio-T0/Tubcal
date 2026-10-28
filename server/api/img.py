"""`GET /api/img?u=<url>` — a picture, fetched by the server.

The terminal client draws thumbnails and covers, but talks to nobody but this server,
so pictures come through here: no cookies, no Referer, the same browser User-Agent as
everything else, one egress for everything.

Because any local web page can address this server, the endpoint is narrow:
- http(s) on the usual ports, no user:password@ in the URL;
- the platforms' own image hosts (matched exactly or by a dot-suffix, so
  `ytimg.com.example.org` and `notytimg.com` aren't theirs) go through the server's
  anonymous session;
- any other host (a podcast's cover art, which lives wherever its feed does) only when
  every address its name resolves to is a public one: nothing on this machine, the
  local network, link-local or reserved ranges. The connection then goes to the very
  address that was checked (with the name kept for TLS), so a name that answers
  differently the second time can't steer it inside;
- redirects are followed by hand, at most three, each hop checked the same way;
- the body must be a raster picture by its first bytes (JPEG, PNG, GIF, WebP, AVIF);
  never SVG or HTML, which on this origin could script the API;
- `nosniff` and a sandboxing CSP on the answer; 5 MB at most; six at a time;
- a top-level navigation is refused (localguard lets those through for OAuth).

Nothing is kept on the server's disk; the terminal caches what it shows.
"""

import socket
import threading
from urllib.parse import urljoin, urlsplit

from flask import Blueprint, Response, request

from . import err
from .. import config, httpc
from ..httpc import public

img_bp = Blueprint("img", __name__, url_prefix="/api")

HOSTS = (
    "ytimg.com", "ggpht.com", "googleusercontent.com",       # YouTube thumbnails, channel faces
    "anilist.co",                                             # covers, banners, characters
    "githubusercontent.com", "githubassets.com", "gravatar.com",
    "redd.it", "redditmedia.com", "redditstatic.com",
)
MAX_BYTES = 5 * 1024 * 1024
MAX_HOPS = 3
_slots = threading.BoundedSemaphore(6)


def well_formed(url):
    """http(s) on a usual port, with a host and without credentials."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or parts.username or parts.password or not parts.hostname:
        return False
    return port in (None, 80, 443)


def platform_host(url):
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in HOSTS)


def allowed(url):
    """Well formed, on one of the platforms' own image hosts."""
    return well_formed(url) and platform_host(url)


def resolve(host, port):
    """Every address `host` resolves to (a seam for the tests)."""
    return [info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


def public_addresses(url):
    """The addresses to connect to for `url`, or None unless every one is public."""
    parts = urlsplit(url)
    try:
        addrs = resolve(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except (OSError, UnicodeError):
        return None
    if not addrs or not all(public(a) for a in addrs):
        return None
    return list(dict.fromkeys(addrs))


class _Pinned:
    """A urllib3 answer, shaped like the requests one the code below reads."""

    def __init__(self, resp, pool):
        self._resp, self._pool = resp, pool
        self.status_code = resp.status
        self.headers = resp.headers

    def iter_content(self, n):
        return self._resp.stream(n)

    def close(self):
        self._resp.release_conn()
        self._pool.close()


def pinned_get(url, addrs):
    """GET `url` from one of the checked addresses, never through a fresh lookup."""
    import certifi
    import urllib3
    parts = urlsplit(url)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    headers = {"Host": parts.netloc, "User-Agent": config.BROWSER_UA, "Accept": "image/*"}
    timeout = urllib3.Timeout(connect=5, read=15)
    last = None
    for addr in addrs:
        if parts.scheme == "https":
            pool = urllib3.HTTPSConnectionPool(
                addr, parts.port or 443, timeout=timeout, retries=False, maxsize=1,
                server_hostname=parts.hostname, assert_hostname=parts.hostname,
                cert_reqs="CERT_REQUIRED", ca_certs=certifi.where())
        else:
            pool = urllib3.HTTPConnectionPool(addr, parts.port or 80, timeout=timeout, retries=False, maxsize=1)
        try:
            resp = pool.urlopen("GET", path, headers=headers, redirect=False, preload_content=False,
                                assert_same_host=False)
            return _Pinned(resp, pool)
        except Exception as e:   # this address didn't answer: the next one
            pool.close()
            last = e
    raise last or OSError("no address")


def fetch(url):
    """One hop: the platforms through the anonymous session, anyone else pinned."""
    if platform_host(url):
        return httpc.anon_session.get(url, headers={"User-Agent": config.BROWSER_UA}, timeout=(5, 15),
                                      allow_redirects=False, stream=True)
    addrs = public_addresses(url)
    if addrs is None:
        raise PermissionError(url)
    return pinned_get(url, addrs)


def sniff(head):
    """The picture type from its first bytes, or None."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return "image/avif"
    return None


@img_bp.get("/img")
def img():
    if request.headers.get("Sec-Fetch-Mode") == "navigate":
        return err("not a page", 403)
    url = request.args.get("u") or ""
    if not well_formed(url):
        return err("not a picture address Tubcal fetches", 403)
    if not _slots.acquire(timeout=20):
        return err("too many pictures at once", 503)
    try:
        for _ in range(MAX_HOPS + 1):
            try:
                resp = fetch(url)
            except PermissionError:
                return err("that picture is on this machine or your own network", 403)
            except Exception as e:
                return err(f"picture fetch failed: {type(e).__name__}", 502)
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                nxt = urljoin(url, resp.headers["Location"])
                resp.close()
                if not well_formed(nxt):
                    return err("the picture moved to an address Tubcal doesn't fetch", 403)
                url = nxt
                continue
            break
        else:
            return err("too many redirects", 502)
        try:
            if resp.status_code != 200:
                return err(f"the picture host answered {resp.status_code}", 502)
            body = bytearray()
            for chunk in resp.iter_content(65536):
                body += chunk
                if len(body) > MAX_BYTES:
                    return err("picture too large", 502)
        except Exception as e:
            return err(f"picture fetch failed: {type(e).__name__}", 502)
        finally:
            resp.close()
        kind = sniff(bytes(body[:16]))
        if not kind:
            return err("not a picture", 502)
        out = Response(bytes(body), mimetype=kind)
        out.headers["X-Content-Type-Options"] = "nosniff"
        out.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return out
    finally:
        _slots.release()
