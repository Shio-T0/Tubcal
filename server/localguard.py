"""Keep the local server local: only this machine's own pages may drive it.

Binding to 127.0.0.1 keeps other machines out, but not other *websites*: any page
open in the browser can address http://127.0.0.1:5000. Three ways in, three checks:

- **WebSockets ignore CORS.** A page anywhere could open the Composing Room's
  terminal socket and type into a shell. A browser always sends `Origin` on a
  WebSocket handshake (and on every POST and CORS fetch), so an `Origin` that
  isn't this machine is refused.
- **DNS rebinding.** A name the attacker controls can be re-pointed at 127.0.0.1,
  which makes their page "same-origin" with this server and lets it read every
  response. Its requests still carry *their* name in `Host`, so a `Host` that
  isn't a loopback name (or one listed in TUBCAL_ALLOWED_HOSTS) is refused.
- **Cross-site subresources.** `<img src>`/`<script src>` aimed at /api/ carry no
  `Origin`, but modern browsers mark them `Sec-Fetch-Site: cross-site`; those are
  refused too. Top-level navigations stay allowed, since that's how an OAuth
  provider hands the browser back to /api/oauth/<provider>/callback, and how a
  link to Tubcal from another app opens it. That is why a GET under /api/ must
  never change anything.

- **Other local servers' pages.** A page that Jupyter, some project's dev server or
  `python -m http.server` shows is on 127.0.0.1 too, so an `Origin` counts as
  Tubcal's own only at Tubcal's port or a Vite dev server's (config.DEV_PORTS).

Requests with none of these headers (curl, the launcher's health check, the
terminal interface, tests) pass: what keeps other accounts' programs out is
server/peers.py, which checks who owns each connection. On the phone every app
shares 127.0.0.1, so there the API also wants the app's access key (a cookie in
its WebView, a header from its Kotlin; config.ACCESS_KEY).
`create_app` also sends `frame-ancestors 'self'`, so no other site can show
Tubcal in a frame and steer clicks in it, and a sandbox policy on every /api/
response, so nothing there runs as a page when a link opens it in a tab.
"""

import hmac
import ipaddress
import re
from urllib.parse import urlsplit

from . import config

_LOOPBACK_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}


def _strip_port(hostport):
    hostport = (hostport or "").strip().lower()
    if hostport.startswith("["):  # [::1]:5000
        return hostport[1:hostport.find("]")] if "]" in hostport else ""
    if hostport.count(":") == 1:
        return hostport.split(":", 1)[0]
    return hostport  # a bare IPv6 address, or no port


def is_loopback_host(hostport):
    """True for a Host/authority naming this machine: localhost (and any
    *.localhost, which browsers resolve to loopback themselves), 127.0.0.0/8,
    ::1, the address the server was told to bind, or a name in
    TUBCAL_ALLOWED_HOSTS."""
    host = _strip_port(hostport).rstrip(".")
    if not host:
        return False
    if host in _LOOPBACK_NAMES or host.endswith(".localhost"):
        return True
    if host == str(config.HOST).lower() or host in config.ALLOWED_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_local_origin(origin):
    """True for an Origin header from Tubcal's own pages: this machine at Tubcal's
    port or a Vite dev server's (config.DEV_PORTS), or a name in
    TUBCAL_ALLOWED_HOSTS at any port. A page another local server shows (Jupyter,
    some project's dev server, `python -m http.server` over a downloaded file) is
    another site, and "null" (sandboxed frames, file://) is nobody's."""
    parts = urlsplit(origin or "")
    if parts.scheme not in ("http", "https") or not is_loopback_host(parts.netloc):
        return False
    if _strip_port(parts.netloc).rstrip(".") in config.ALLOWED_HOSTS:
        return True
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return False
    return port == config.PORT or port in config.DEV_PORTS


KEY_COOKIE = "tubcal_key"
KEY_HEADER = "X-Tubcal-Key"
# An OAuth provider sends the browser back here, and on the phone that's the
# system browser, which has no key. The callback checks its own one-time state.
_KEYLESS = re.compile(r"/api/oauth/[a-z]+/callback")


def has_key(headers, cookies):
    """Whether a request carries the phone's access key (config.ACCESS_KEY)."""
    want = config.ACCESS_KEY or ""
    got = headers.get(KEY_HEADER) or (cookies or {}).get(KEY_COOKIE) or ""
    return bool(want) and hmac.compare_digest(got.encode(), want.encode())


def refusal(path, headers, cookies=None):
    """Why this request may not proceed ("host", "origin", "cross-site" or, on the
    phone, "key"), or None when it may. `headers` is any case-insensitive mapping
    (Flask's request.headers), `cookies` the request's cookies."""
    if (config.ACCESS_KEY and path.startswith("/api/") and not _KEYLESS.fullmatch(path)
            and not has_key(headers, cookies)):
        return "key"
    host = headers.get("Host")
    if host and not is_loopback_host(host):
        return "host"
    origin = headers.get("Origin")
    if origin is not None and not is_local_origin(origin):
        return "origin"
    if path.startswith("/api/") and headers.get("Sec-Fetch-Site") == "cross-site":
        # Only a page opening in a tab of its own: a cross-site frame is
        # a navigation too, but not one a person chose.
        if not (headers.get("Sec-Fetch-Mode") == "navigate"
                and headers.get("Sec-Fetch-Dest") in (None, "document")):
            return "cross-site"
    return None


def message(why):
    """The sentence a refused request gets back."""
    if why == "host":
        return (f"Tubcal only answers at 127.0.0.1 or localhost. Open http://{config.HOST}:{config.PORT}, "
                "or add the name you used to TUBCAL_ALLOWED_HOSTS in Tubcal's .env file.")
    if why == "key":
        return "Only the Tubcal app on this phone can use its server."
    return ("This request came from another website, so Tubcal turned it down. "
            f"Open Tubcal at http://{config.HOST}:{config.PORT}.")
