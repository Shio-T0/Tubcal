"""Shared HTTP client: one requests.Session, per-host minimum spacing."""

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

_host_locks = {}
_host_last = {}
_registry_lock = threading.Lock()


def get(url, *, ua=config.BROWSER_UA, headers=None, timeout=15, **kwargs):
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)

    host = urlparse(url).hostname or ""
    interval = config.HOST_INTERVALS.get(host)
    if interval:
        with _registry_lock:
            lock = _host_locks.setdefault(host, threading.Lock())
        with lock:
            wait = _host_last.get(host, 0) + interval - time.time()
            if wait > 0:
                time.sleep(wait)
            _host_last[host] = time.time()
            resp = session.get(url, headers=hdrs, timeout=timeout, **kwargs)
    else:
        resp = session.get(url, headers=hdrs, timeout=timeout, **kwargs)

    resp.raise_for_status()
    return resp


def post(url, *, ua=config.BROWSER_UA, headers=None, timeout=15, **kwargs):
    hdrs = dict(headers or {})
    hdrs.setdefault("User-Agent", ua)
    resp = session.post(url, headers=hdrs, timeout=timeout, **kwargs)
    resp.raise_for_status()
    return resp
