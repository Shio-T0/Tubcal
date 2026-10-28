"""The terminal's one way to the outside world: the local Tubcal server.

Every request goes to 127.0.0.1 through a transport that refuses any other host, so
nothing in the TUI can quietly fetch from the internet: pictures come through the
server's `/api/img`, videos through its HLS endpoints. `trust_env=False` keeps proxy
variables out of it too.

The private session is one gate here: while it's on, nothing that records what you
watch (history, progress) is sent.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote

import httpx

LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]"}


class ApiError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status

    @property
    def unreachable(self) -> bool:
        return self.status == 0


class LoopbackOnly(httpx.BaseTransport):
    """Wraps a transport and refuses any request that isn't for this machine."""

    def __init__(self, inner: httpx.BaseTransport | None = None):
        self.inner = inner or httpx.HTTPTransport(retries=0)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.host not in LOOPBACK:
            raise ApiError(f"refused a request for {request.url.host}: the terminal only talks to this machine")
        return self.inner.handle_request(request)

    def close(self) -> None:
        self.inner.close()


def seg(value: str) -> str:
    """An item id as one path segment (ids carry ':', '/', '#')."""
    return quote(str(value), safe="")


def server_port(repo: Path | None = None) -> int:
    """TUBCAL_PORT, else the checkout's .env, else 5000 (the launcher's order)."""
    if os.environ.get("TUBCAL_PORT", "").isdigit():
        return int(os.environ["TUBCAL_PORT"])
    if repo:
        env = repo / ".env"
        try:
            for line in env.read_text().splitlines():
                key, _, val = line.partition("=")
                if key.strip() == "TUBCAL_PORT" and val.strip().strip("'\"").isdigit():
                    return int(val.strip().strip("'\""))
        except OSError:
            pass
    return 5000


class Api:
    def __init__(self, base: str, *, transport: httpx.BaseTransport | None = None, private: bool = False):
        self.base = base.rstrip("/")
        self.private = private
        self._http = httpx.Client(
            base_url=self.base,
            transport=LoopbackOnly(transport),
            trust_env=False,
            timeout=httpx.Timeout(20.0, connect=0.5),
            headers={"User-Agent": "tubcal-tui"},
        )

    def url(self, path: str) -> str:
        """An absolute URL for a server path (mpv needs these)."""
        return self.base + (path if path.startswith("/") else "/" + path)

    def _call(self, method: str, path: str, *, params=None, json=None, timeout=None):
        if not path.startswith("/api/"):
            path = "/api" + (path if path.startswith("/") else "/" + path)
        kw = {}
        if timeout is not None:
            kw["timeout"] = timeout
        if json is not None or method in ("POST", "PUT", "PATCH", "DELETE"):
            kw["json"] = json if json is not None else {}  # GitHub writes want a JSON body
        try:
            r = self._http.request(method, path, params=params, **kw)
        except ApiError:
            raise
        except httpx.TimeoutException:
            raise ApiError("The Tubcal server took too long to answer.") from None
        except httpx.HTTPError:
            raise ApiError("The Tubcal server isn't answering.") from None
        try:
            body = r.json()
        except ValueError:
            raise ApiError(f"The server answered {r.status_code} without data.", r.status_code) from None
        if not isinstance(body, dict) or not body.get("ok"):
            msg = (body or {}).get("error") if isinstance(body, dict) else None
            raise ApiError(msg or f"The server answered {r.status_code}.", r.status_code or 500)
        return body.get("data")

    def get(self, path, /, timeout=None, **params):   # positional: a query can be called `path`
        return self._call("GET", path, params={k: v for k, v in params.items() if v is not None}, timeout=timeout)

    def post(self, path, json=None, timeout=None):
        return self._call("POST", path, json=json, timeout=timeout)

    def put(self, path, json=None):
        return self._call("PUT", path, json=json)

    def patch(self, path, json=None):
        return self._call("PATCH", path, json=json)

    def delete(self, path, **params):
        return self._call("DELETE", path, params=params or None)

    # ── the calls that record what you watch: the private session's gate ────

    def record_open(self, item: dict) -> None:
        """History first, always before progress (a progress row without one is filed
        as YouTube)."""
        if self.private:
            return
        self.post("/history", {"item": item})

    def record_progress(self, item_id: str, position: float, duration: float) -> None:
        if self.private or not duration:
            return
        self.post("/progress", {"item_id": item_id, "position": round(position, 1),
                                "duration": round(duration, 1)})

    def get_bytes(self, path: str, timeout: float = 20, **params) -> bytes:
        """A raw answer (a picture from /api/img). Errors still come as the envelope."""
        if not path.startswith("/api/"):
            path = "/api" + path
        try:
            r = self._http.get(path, params=params, timeout=timeout)
        except httpx.HTTPError:
            raise ApiError("The Tubcal server isn't answering.") from None
        if r.status_code != 200:
            try:
                msg = r.json().get("error")
            except ValueError:
                msg = None
            raise ApiError(msg or f"The server answered {r.status_code}.", r.status_code)
        return r.content

    def health(self, timeout: float = 1.5) -> dict | None:
        try:
            return self.get("/health", timeout=timeout)
        except ApiError:
            return None

    def close(self) -> None:
        self._http.close()
