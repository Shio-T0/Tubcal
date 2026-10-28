"""Pictures for the terminal: fetched through the server's /api/img, cached, and cut to
the exact pixel size of the well they go in.

The cache is $XDG_CACHE_HOME/tubcal/img: a 0700 folder of 0600 files named by the
sha256 of the URL (no titles, no URLs on disk), 200 MB at most (oldest first out), and
nothing older than a week. In a private session nothing is written: pictures are
kept in memory for the session only. `:cache clear` empties it.
"""

from __future__ import annotations

import hashlib
import io
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path

from .api import Api, ApiError

MAX_DISK = 200 * 1024 * 1024
MAX_AGE = 7 * 86400
MEMORY_ITEMS = 48


def cache_dir() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    d = base / "tubcal" / "img"
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    os.chmod(d.parent, 0o700)
    return d


def youtube_thumb(item: dict) -> str | None:
    """hqdefault exists for every video (480×360, letterboxed to 4:3; cropped later)."""
    vid = (item.get("extra") or {}).get("video_id")
    if not vid:
        iid = item.get("id") or ""
        vid = iid[3:] if iid.startswith("yt:") else None
    return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else item.get("thumbnail")


class Pictures:
    def __init__(self, api: Api, *, private: bool = False, folder: Path | None = None):
        self.api = api
        self.private = private
        self._folder = folder
        self._bytes: OrderedDict[str, bytes] = OrderedDict()   # private session / recent
        self._lock = threading.Lock()

    @property
    def folder(self) -> Path:
        if self._folder is None:
            self._folder = cache_dir()
        return self._folder

    def _path(self, url: str) -> Path:
        return self.folder / hashlib.sha256(url.encode()).hexdigest()

    def raw(self, url: str) -> bytes | None:
        """The picture's bytes: memory, then disk, then the server. None when it can't."""
        with self._lock:
            if url in self._bytes:
                self._bytes.move_to_end(url)
                return self._bytes[url]
        data = None
        if not self.private:
            p = self._path(url)
            try:
                data = p.read_bytes()
                os.utime(p)
            except OSError:
                data = None
        if data is None:
            try:
                data = self.api.get_bytes("/img", u=url)
            except ApiError:
                return None
            if not self.private:
                self._write(url, data)
        with self._lock:
            self._bytes[url] = data
            while len(self._bytes) > MEMORY_ITEMS:
                self._bytes.popitem(last=False)
        return data

    def _write(self, url: str, data: bytes) -> None:
        p = self._path(url)
        tmp = p.with_suffix(".tmp")
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, p)
        except OSError:
            pass

    def fitted(self, url: str, cols: int, rows: int, cell_px: tuple[int, int], *, cover: bool = True):
        """A PIL image exactly cols×rows cells big: cropped to fill (cover) or letterboxed."""
        data = self.raw(url)
        if data is None:
            return None
        try:
            from PIL import Image
            Image.MAX_IMAGE_PIXELS = 30_000_000
            im = Image.open(io.BytesIO(data))
            im.load()
            im = im.convert("RGB")
        except Exception:
            return None
        cw, ch = cell_px if all(cell_px) else (8, 18)
        tw, th = max(1, cols * cw), max(1, rows * ch)
        im = _drop_letterbox(im)
        if cover:
            scale = max(tw / im.width, th / im.height)
            nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
            im = im.resize((nw, nh), Image.LANCZOS)
            left, top = (nw - tw) // 2, (nh - th) // 2
            return im.crop((left, top, left + tw, top + th))
        im.thumbnail((tw, th), Image.LANCZOS)
        return im

    def prune(self) -> None:
        """Older than a week out, then the oldest until under 200 MB."""
        if self.private:
            return
        now = time.time()
        files = []
        for p in self.folder.iterdir():
            try:
                st = p.stat()
            except OSError:
                continue
            if now - st.st_mtime > MAX_AGE or p.suffix == ".tmp":
                p.unlink(missing_ok=True)
                continue
            files.append((st.st_mtime, st.st_size, p))
        total = sum(s for _, s, _ in files)
        for _, size, p in sorted(files):
            if total <= MAX_DISK:
                break
            p.unlink(missing_ok=True)
            total -= size

    def clear(self) -> int:
        n = 0
        with self._lock:
            self._bytes.clear()
        if self._folder is not None or not self.private:
            for p in self.folder.iterdir():
                p.unlink(missing_ok=True)
                n += 1
        return n

    def go_private(self) -> None:
        self.private = True


def _drop_letterbox(im):
    """YouTube's hqdefault is 4:3 with black bars over and under a 16:9 picture."""
    w, h = im.size
    if abs(w / h - 4 / 3) > 0.02:
        return im
    band = round(h * 0.125)
    top = im.crop((0, 0, w, band)).convert("L").getextrema()
    bottom = im.crop((0, h - band, w, h)).convert("L").getextrema()
    if top[1] < 24 and bottom[1] < 24:
        return im.crop((0, band, w, h - band))
    return im
