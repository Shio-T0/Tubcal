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

Requests with none of these headers (curl, the launcher's health check, the
phone app's own code, tests) come from this machine by construction and pass.
`create_app` also sends `frame-ancestors 'self'`, so no other site can show
Tubcal in a frame and steer clicks in it.
"""

import ipaddress
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
    """True for an Origin header from a page this machine serves (any port, so
    the Vite dev server on :5173 counts). "null" (sandboxed frames, file://) and
    anything else does not."""
    parts = urlsplit(origin or "")
    return parts.scheme in ("http", "https") and is_loopback_host(parts.netloc)


def refusal(path, headers):
    """Why this request may not proceed ("host", "origin" or "cross-site"), or
    None when it may. `headers` is any case-insensitive mapping (Flask's
    request.headers)."""
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
    return "This request came from another website, so Tubcal turned it down."
