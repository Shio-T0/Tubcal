"""HTTP surface for The Composing Room (code editor).

Every filesystem path from the client is *relative to* config.EDITOR_ROOT and is
hard-contained: it must resolve (symlinks followed) inside the root or the
request is rejected with 400. Nothing in this blueprint ever touches a path it
did not first pass through _safe().
"""

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from flask import Blueprint, request

from .. import config, db
from . import err, ok

editor_bp = Blueprint("editor", __name__, url_prefix="/api/editor")

# Directories nobody wants in a file finder or a project grep.
SKIP_DIRS = {".git", "node_modules", "dist", "build", "target", "__pycache__",
             ".venv", "venv", ".mypy_cache", ".ruff_cache", ".pytest_cache",
             ".cache", ".next", ".tox"}


class Unsafe(ValueError):
    pass


def _safe(rel):
    """Resolve a client-supplied path against EDITOR_ROOT and refuse escapes.

    Follows symlinks (resolve()), so a link pointing outside the root is caught
    the same as a ../ traversal. Absolute paths joined onto the root replace it
    entirely under pathlib, so they too end up rejected unless they already
    live inside the root.
    """
    rel = (rel or "").strip()
    root = config.EDITOR_ROOT
    p = (root / rel).resolve()
    if p != root and not p.is_relative_to(root):
        raise Unsafe(f"path escapes the workspace: {rel!r}")
    return p


def _rel(p: Path) -> str:
    return str(p.relative_to(config.EDITOR_ROOT))


def _entry(p: Path):
    try:
        st = p.stat()
    except OSError:
        return None
    return {
        "name": p.name,
        "path": _rel(p),
        "type": "dir" if p.is_dir() else "file",
        "size": st.st_size,
        "mtime": int(st.st_mtime),
    }


def _looks_binary(chunk: bytes) -> bool:
    return b"\x00" in chunk


def _run(cmd, cwd=None, timeout=None):
    """House subprocess pattern: absolute binary, list form, explicit timeout."""
    exe = shutil.which(cmd[0])
    if not exe:
        raise RuntimeError(f"{cmd[0]} not found on PATH")
    return subprocess.run(
        [exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True,
        timeout=timeout or config.EDITOR_SUBPROC_TIMEOUT,
    )


# ---------------------------------------------------------------- status

@editor_bp.get("/status")
def status():
    """What the room can do right now — drives graceful degradation in the UI."""
    try:
        import flask_sock  # noqa: F401
        sockets = True
    except ImportError:
        sockets = False
    from ..editor import lsp
    return ok({
        "root": str(config.EDITOR_ROOT),
        "root_exists": config.EDITOR_ROOT.is_dir(),
        "rg": bool(shutil.which("rg")),
        "git": bool(shutil.which("git")),
        "terminal": sockets,
        "lsp": {lang: lsp.available(lang) for lang in lsp.SERVERS},
        "max_file_bytes": config.EDITOR_MAX_FILE_BYTES,
    })


# ---------------------------------------------------------------- tree / files

@editor_bp.get("/tree")
def tree():
    try:
        base = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    if not base.is_dir():
        return err("not a directory", 404)
    entries = []
    try:
        for child in base.iterdir():
            e = _entry(child)
            if e:
                entries.append(e)
    except PermissionError:
        return err("permission denied", 403)
    # dirs first, then files, case-insensitive — like every file explorer ever
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return ok({"path": _rel(base) if base != config.EDITOR_ROOT else "", "entries": entries})


@editor_bp.get("/files")
def files():
    """Flat recursive file list for the go-to-file finder. Capped, skip-listed."""
    try:
        base = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    limit = 30000
    out = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git"))
        for name in filenames:
            out.append(_rel(Path(dirpath) / name))
            if len(out) >= limit:
                return ok({"files": out, "truncated": True})
    return ok({"files": out, "truncated": False})


@editor_bp.get("/file")
def read_file():
    try:
        p = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    if not p.is_file():
        return err("no such file", 404)
    st = p.stat()
    if st.st_size > config.EDITOR_MAX_FILE_BYTES:
        return err(f"file too large ({st.st_size} bytes)", 413)
    raw = p.read_bytes()
    if _looks_binary(raw[:8192]):
        return err("binary file", 415)
    return ok({
        "path": _rel(p),
        "content": raw.decode("utf-8", errors="replace"),
        "mtime": int(st.st_mtime),
        "size": st.st_size,
    })


@editor_bp.post("/file")
def write_file():
    body = request.get_json(force=True, silent=True) or {}
    if "path" not in body or "content" not in body:
        return err("path and content required")
    try:
        p = _safe(body["path"])
    except Unsafe as e:
        return err(e)
    if p.is_dir():
        return err("path is a directory")
    # Conflict check: the client sends the mtime it loaded; if the file moved
    # on disk since, refuse — the buffer would silently clobber outside edits.
    expect = body.get("mtime")
    if expect is not None and p.exists() and int(p.stat().st_mtime) != int(expect):
        return err("file changed on disk", 409)
    if not p.parent.is_dir():
        return err("parent directory does not exist", 404)
    data = body["content"].encode("utf-8")
    # Atomic: write a sibling temp file, then replace — a crash mid-write can
    # never leave a half-written source file.
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{p.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, p)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return err(f"write failed: {e}", 500)
    st = p.stat()
    return ok({"path": _rel(p), "mtime": int(st.st_mtime), "size": st.st_size})


@editor_bp.post("/mkdir")
def mkdir():
    body = request.get_json(force=True, silent=True) or {}
    try:
        p = _safe(body.get("path", ""))
    except Unsafe as e:
        return err(e)
    if p == config.EDITOR_ROOT:
        return err("path required")
    p.mkdir(parents=True, exist_ok=True)
    return ok({"path": _rel(p)})


@editor_bp.post("/rename")
def rename():
    body = request.get_json(force=True, silent=True) or {}
    try:
        src = _safe(body.get("path", ""))
        dst = _safe(body.get("to", ""))
    except Unsafe as e:
        return err(e)
    if src == config.EDITOR_ROOT or dst == config.EDITOR_ROOT:
        return err("cannot rename the workspace root")
    if not src.exists():
        return err("no such file", 404)
    if dst.exists():
        return err("target already exists", 409)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return ok({"path": _rel(dst)})


@editor_bp.post("/delete")
def delete():
    body = request.get_json(force=True, silent=True) or {}
    try:
        p = _safe(body.get("path", ""))
    except Unsafe as e:
        return err(e)
    if p == config.EDITOR_ROOT:
        return err("cannot delete the workspace root")
    if not p.exists():
        return err("no such file", 404)
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return ok({"deleted": True})


# ---------------------------------------------------------------- search

@editor_bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return err("query too short")
    try:
        base = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    cap = config.EDITOR_SEARCH_MAX_RESULTS
    if shutil.which("rg"):
        try:
            return ok(_search_rg(q, base, cap))
        except (RuntimeError, subprocess.TimeoutExpired):
            pass  # fall through to the slow walker
    return ok(_search_walk(q, base, cap))


def _search_rg(q, base, cap):
    proc = _run([
        "rg", "--json", "--smart-case", "--fixed-strings",
        "--max-count", "20", "--max-columns", "400", "--max-filesize", "1M",
        "--", q, str(base),
    ])
    hits, truncated = [], False
    for line in proc.stdout.splitlines():
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("type") != "match":
            continue
        d = msg["data"]
        text = d["lines"].get("text", "").rstrip("\n")
        hits.append({
            "path": _rel(Path(d["path"]["text"])),
            "line": d["line_number"],
            "text": text[:400],
            "col": (d["submatches"][0]["start"] if d.get("submatches") else 0),
        })
        if len(hits) >= cap:
            truncated = True
            break
    return {"hits": hits, "truncated": truncated, "engine": "rg"}


def _search_walk(q, base, cap):
    ql = q.lower()
    hits, truncated = [], False
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            p = Path(dirpath) / name
            try:
                if p.stat().st_size > 1024 * 1024:
                    continue
                raw = p.read_bytes()
            except OSError:
                continue
            if _looks_binary(raw[:8192]):
                continue
            text = raw.decode("utf-8", errors="replace")
            for i, line in enumerate(text.splitlines(), 1):
                idx = line.lower().find(ql)
                if idx >= 0:
                    hits.append({"path": _rel(p), "line": i, "text": line[:400], "col": idx})
                    if len(hits) >= cap:
                        return {"hits": hits, "truncated": True, "engine": "walk"}
    return {"hits": hits, "truncated": truncated, "engine": "walk"}


# ---------------------------------------------------------------- git

def _repo_of(p: Path):
    """The git worktree containing p, or None — contained to the workspace."""
    probe = p if p.is_dir() else p.parent
    proc = _run(["git", "-C", str(probe), "rev-parse", "--show-toplevel"])
    if proc.returncode != 0:
        return None
    top = Path(proc.stdout.strip())
    return top if top == config.EDITOR_ROOT or top.is_relative_to(config.EDITOR_ROOT) else None


@editor_bp.get("/git/status")
def git_status():
    try:
        p = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    if not shutil.which("git"):
        return err("git unavailable", 503)
    repo = _repo_of(p)
    if not repo:
        return ok({"repo": None})
    branch = _run(["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    porcelain = _run(["git", "-C", str(repo), "status", "--porcelain"]).stdout
    changes = []
    for line in porcelain.splitlines():
        if len(line) < 4:
            continue
        st, rel = line[:2], line[3:]
        if " -> " in rel:
            rel = rel.split(" -> ", 1)[1]
        changes.append({"status": st.strip() or "??", "path": _rel(repo / rel)})
    return ok({"repo": _rel(repo) if repo != config.EDITOR_ROOT else "", "branch": branch, "changes": changes})


@editor_bp.get("/git/diff")
def git_diff():
    """Per-line gutter marks for one file: add / mod lines + del anchors."""
    try:
        p = _safe(request.args.get("path", ""))
    except Unsafe as e:
        return err(e)
    if not (shutil.which("git") and p.is_file()):
        return ok({"marks": []})
    repo = _repo_of(p)
    if not repo:
        return ok({"marks": []})
    proc = _run(["git", "-C", str(repo), "diff", "--no-color", "--unified=0",
                 "--", str(p.relative_to(repo))])
    marks = []
    for line in proc.stdout.splitlines():
        if not line.startswith("@@"):
            continue
        # @@ -a[,b] +c[,d] @@ — b/d default to 1 when omitted
        try:
            old, new = line.split(" ")[1:3]
            ob = int(old.split(",")[1]) if "," in old else 1
            nparts = new[1:].split(",")
            nc = int(nparts[0])
            nd = int(nparts[1]) if len(nparts) > 1 else 1
        except (ValueError, IndexError):
            continue
        if nd == 0:
            marks.append({"line": max(nc, 1), "type": "del"})
        else:
            kind = "add" if ob == 0 else "mod"
            marks.extend({"line": nc + i, "type": kind} for i in range(nd))
    return ok({"marks": marks})


# ---------------------------------------------------------------- session state

@editor_bp.get("/state")
def get_state():
    return ok({"session": db.editor_state_get("session", None)})


@editor_bp.post("/state")
def set_state():
    body = request.get_json(force=True, silent=True) or {}
    db.editor_state_set("session", body.get("session"))
    return ok({"saved": True, "at": int(time.time())})
