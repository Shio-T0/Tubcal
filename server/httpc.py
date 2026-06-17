"""Shared HTTP client: one requests.Session, per-host minimum spacing."""

import threading
import time
from urllib.parse import urlparse

import requests

from . import config

session = requests.Session()

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
