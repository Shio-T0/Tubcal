"""Only Tubcal's own pages may talk to Tubcal.

The server listens on 127.0.0.1, but any web page open in the browser can still
send requests there, so `refusal()` turns away what didn't come from Tubcal:

- Host: a site can point its own name at 127.0.0.1 (DNS rebinding) and then read
  Tubcal's answers as if it were Tubcal. Its requests still carry that name, so
  only loopback names (and any in TUBCAL_ALLOWED_HOSTS) are answered.
- Origin: a page elsewhere can't read the answers, but it can send a write (a
  form post, a text/plain fetch) or open a WebSocket — the editor's terminal
  among them, and CORS doesn't cover sockets. Browsers stamp both with the
  page's origin, so another origin is refused.
- Sec-Fetch-Site: an <img> or <script> pointed at /api/ carries no Origin but
  says cross-site. Only a top-level navigation (an OAuth callback, a link) gets
  through that way, which is why a GET under /api/ must never change anything.

A request with none of these headers isn't from a web page (curl, the launcher,
the phone app's own code) and passes.
"""

import ipaddress
from urllib.parse import urlsplit

from . import config


def _name(url):
    """'//127.0.0.1:5000' / 'http://[::1]:5173' / '//Localhost' -> the bare, lower-case name."""
    try:
        return urlsplit(url).hostname or ""
    except ValueError:
        return ""


def _ours(name):
    if name == "localhost" or name.endswith(".localhost") or name in config.ALLOWED_HOSTS:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def host_allowed(host):
    return _ours(_name(f"//{host}"))


def origin_allowed(origin):
    # "null" (a sandboxed frame, a file:// page) is never one of Tubcal's pages.
    if not origin.startswith(("http://", "https://")):
        return False
    return _ours(_name(origin))


def refusal(request):
    """Why this request is turned away, or None to let it through."""
    if not host_allowed(request.host):
        return "host"
    origin = request.headers.get("Origin")
    if origin is not None and not origin_allowed(origin):
        return "origin"
    h = request.headers
    if (request.path.startswith("/api/") and h.get("Sec-Fetch-Site") == "cross-site"
            and not (h.get("Sec-Fetch-Mode") == "navigate" and h.get("Sec-Fetch-Dest") == "document")):
        return "cross-site"
    return None
