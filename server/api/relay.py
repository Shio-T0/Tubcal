"""Relaying media bytes from a CDN to the player, without the player ever seeing
a dropped connection.

A video segment is a few hundred KB to a few MB; on a flaky link the upstream
connection can die halfway through one. Relayed naively, that truncated body
reaches hls.js / the <video> element as a failed fragment — enough of those and
playback stalls. Here, a body that breaks mid-way is *resumed*: we ask for the
rest from the exact byte where it stopped (a Range request against the same — or
a refreshed — URL) and keep streaming, so the browser sees one unbroken
response.
"""

import re

import requests
from flask import Response, stream_with_context

# Headers worth relaying from the upstream CDN response to the browser.
PASS_HEADERS = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")

_CONTENT_RANGE = re.compile(r"bytes\s+(\d+)-(\d+)/(\d+|\*)")


def body_span(upstream):
    """(first, last) absolute byte offsets of this response's body, last None if
    open-ended — or None when the body can't be resumed (not a 200/206)."""
    if upstream.status_code == 206:
        m = _CONTENT_RANGE.match(upstream.headers.get("Content-Range", ""))
        return (int(m.group(1)), int(m.group(2))) if m else None
    if upstream.status_code == 200:
        return (0, None)
    return None


def resumable_chunks(upstream, reopen=None, *, chunk_size=65536, max_resumes=4):
    """Yield the upstream body; if the connection breaks mid-body, ask `reopen`
    (given a Range header value) for the remainder and carry on from there.
    Pure generator — the Flask wrapping is in `relay()`."""
    span = body_span(upstream)
    sent = 0
    resumes = 0
    try:
        while True:
            try:
                for chunk in upstream.iter_content(chunk_size=chunk_size):
                    if chunk:
                        sent += len(chunk)
                        yield chunk
                return
            except requests.RequestException:
                if reopen is None or span is None or resumes >= max_resumes:
                    raise
                first, last = span
                if last is not None and first + sent > last:
                    return  # everything was delivered; only the close failed
                resumes += 1
                upstream.close()
                nxt = reopen(f"bytes={first + sent}-{'' if last is None else last}")
                if nxt is None or nxt.status_code != 206:
                    if nxt is not None:
                        nxt.close()
                    raise
                upstream = nxt
    finally:
        upstream.close()


def relay(upstream, *, reopen=None, default_ct="application/octet-stream"):
    """Stream an opened upstream response back to the browser with the headers a
    media element / hls.js cares about. `reopen(range)` lets a body that breaks
    mid-way be resumed (see `resumable_chunks`)."""
    headers = {k: upstream.headers[k] for k in PASS_HEADERS if k in upstream.headers}
    headers.setdefault("Accept-Ranges", "bytes")
    return Response(
        stream_with_context(resumable_chunks(upstream, reopen)),
        status=upstream.status_code,
        headers=headers,
        content_type=upstream.headers.get("Content-Type", default_ct),
    )
