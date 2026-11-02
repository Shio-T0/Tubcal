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
PASS_HEADERS = ("Content-Length", "Content-Range", "Accept-Ranges")

_CONTENT_RANGE = re.compile(r"bytes\s+(\d+)-(\d+)/(\d+|\*)")

# The upstream's Content-Type is kept only when it names media (some anime CDNs label
# their segments as pictures). Anything else, HTML above all, gets the endpoint's own
# type: the anime proxies fetch whatever a source's playlist names, and a link on any
# website can open /api/anime/sub?u=… in a tab, so relaying text/html would run a
# stranger's page as Tubcal itself. nosniff and the sandbox keep even a mislabelled
# body inert.
_MEDIA_TYPE = re.compile(
    r"(video|audio)/[\w.+-]+|application/(vnd\.apple\.mpegurl|x-mpegurl|octet-stream|mp4)"
    r"|binary/octet-stream|text/(vtt|plain)|image/(png|jpeg|gif|webp|avif)",
    re.I,
)
INERT = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}


def media_type(upstream_type, default):
    """`upstream_type` when it names media, else `default`."""
    base = (upstream_type or "").split(";", 1)[0].strip()
    return upstream_type if base and _MEDIA_TYPE.fullmatch(base) else default


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
    headers.update(INERT)
    return Response(
        stream_with_context(resumable_chunks(upstream, reopen)),
        status=upstream.status_code,
        headers=headers,
        content_type=media_type(upstream.headers.get("Content-Type"), default_ct),
    )
