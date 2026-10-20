"""GitHub on this machine: the clones in the Composing Room's workspace.

`clones()` finds the git checkouts under config.EDITOR_ROOT (one or two levels
down) whose remote is on GitHub, and reads each one's branch, what's changed,
and how far it sits from its upstream — all local, from `git status` and `git
log`, with GIT_OPTIONAL_LOCKS=0 so a look never takes the index lock from under
a git command the user is running. With an account linked, `upstream()` also
asks GitHub whether the branch has moved since the last fetch (one ETag'd call,
free when unchanged).

`start_clone()` clones a repository into the workspace in a background thread
(`git clone --filter=blob:none`: full history, file contents fetched as
needed), reporting git's own progress through `clone_status()`. `fetch()` runs
`git fetch --prune` in one clone — it updates remote-tracking branches only and
never touches the working tree.

git is optional: without it (the phone build), `available()` is False and the
room hides all of this.
"""

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .. import cache, config
from . import github

_ENV = {
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=15",
    "LC_ALL": "C",
}
_SKIP = {"node_modules", "target", "dist", "build", "venv", ".venv", "__pycache__"}
MAX_CLONES = 200


def available():
    return bool(shutil.which("git")) and config.EDITOR_ROOT.is_dir()


def _git(path, *args, timeout=6):
    r = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, **_ENV})
    return r.returncode, r.stdout, r.stderr


_REMOTE = re.compile(r"github\.com[:/]+([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")


def parse_remote(url):
    """'owner/repo' for a GitHub remote URL (https, ssh or scp-style), else None."""
    url = (url or "").strip()
    url = re.sub(r"^[a-z+]+://", "", url)
    url = re.sub(r"^[^@/]+@", "", url)
    url = re.sub(r"^github\.com:\d+/", "github.com/", url)
    m = _REMOTE.search(url)
    if not m or m.group(2) in (".", ".."):
        return None
    return f"{m.group(1)}/{m.group(2)}"


def parse_branch_line(line):
    """The '## …' line of `git status --porcelain=v1 -b`."""
    out = {"branch": None, "upstream": None, "ahead": 0, "behind": 0, "gone": False, "detached": False}
    line = line[3:] if line.startswith("## ") else line
    m = re.match(r"(?:No commits yet on|Initial commit on) (.+)$", line)
    if m:
        out["branch"] = m.group(1)
        return out
    if line.startswith("HEAD (no branch)"):
        out["detached"] = True
        return out
    m = re.match(r"(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$", line)
    if not m:
        return out
    out["branch"], out["upstream"] = m.group(1), m.group(2)
    for part in (m.group(3) or "").split(","):
        part = part.strip()
        if part == "gone":
            out["gone"] = True
        elif part.startswith("ahead "):
            out["ahead"] = int(part[6:])
        elif part.startswith("behind "):
            out["behind"] = int(part[7:])
    return out


def _candidates(root):
    found = []

    def is_repo(p):
        return (p / ".git").exists()

    try:
        children = sorted((c for c in root.iterdir() if c.is_dir() and not c.name.startswith(".")),
                          key=lambda p: p.name.lower())
    except OSError:
        return found
    for child in children:
        if child.name in _SKIP:
            continue
        if is_repo(child):
            found.append(child)
        else:
            try:
                for i, g in enumerate(sorted(child.iterdir(), key=lambda p: p.name.lower())):
                    if i > 60:
                        break
                    if g.is_dir() and not g.name.startswith(".") and g.name not in _SKIP and is_repo(g):
                        found.append(g)
            except OSError:
                pass
        if len(found) >= MAX_CLONES:
            break
    return found


def _remote_of(path):
    code, out, _ = _git(path, "remote", "-v")
    if code != 0:
        return None, None
    remotes = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] not in remotes:
            repo = parse_remote(parts[1])
            if repo:
                remotes[parts[0]] = repo
    if "origin" in remotes:
        return "origin", remotes["origin"]
    for name, repo in remotes.items():
        return name, repo
    return None, None


def inspect(path):
    """One clone's state, or None if it isn't a GitHub checkout."""
    root = config.EDITOR_ROOT
    remote, repo = _remote_of(path)
    if not repo:
        return None
    info = {"path": str(path.relative_to(root)), "name": path.name, "repo": repo, "remote": remote,
            "changed": None, "untracked": None}
    try:
        code, out, _ = _git(path, "status", "--porcelain=v1", "-b", "--untracked-files=normal", timeout=8)
        if code == 0:
            lines = out.splitlines()
            info.update(parse_branch_line(lines[0] if lines else ""))
            info["changed"] = sum(1 for ln in lines[1:] if not ln.startswith("??"))
            info["untracked"] = sum(1 for ln in lines[1:] if ln.startswith("??"))
    except subprocess.TimeoutExpired:
        pass
    code, out, _ = _git(path, "log", "-1", "--format=%H%x1f%ct%x1f%s")
    if code == 0 and out.strip():
        sha, ct, subject = (out.strip().split("\x1f") + ["", "", ""])[:3]
        info.update(head=sha, head_short=sha[:7], head_time=int(ct or 0), subject=subject)
    code, out, _ = _git(path, "rev-parse", "--verify", "--quiet", "@{u}")
    info["upstream_sha"] = out.strip() if code == 0 else None
    try:
        info["fetched_at"] = int((path / ".git" / "FETCH_HEAD").stat().st_mtime)
    except OSError:
        info["fetched_at"] = None
    info["open"] = _open_target(path)
    return info


_scan = {"at": 0, "items": None}
_scan_lock = threading.Lock()


def clones(force=False):
    """Every GitHub checkout in the workspace, most recently committed first."""
    if not available():
        return []
    with _scan_lock:
        if not force and _scan["items"] is not None and time.time() - _scan["at"] < 30:
            return _scan["items"]
    with ThreadPoolExecutor(max_workers=8) as ex:
        items = [i for i in ex.map(_inspect_safe, _candidates(config.EDITOR_ROOT)) if i]
    items.sort(key=lambda i: i.get("head_time") or 0, reverse=True)
    with _scan_lock:
        _scan.update(at=time.time(), items=items)
    return items


def _inspect_safe(p):
    try:
        return inspect(p)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def find(repo):
    """The local clone of 'owner/repo', if there is one."""
    want = repo.lower()
    for c in clones():
        if c["repo"].lower() == want:
            return c
    return None


def upstream(clone):
    """Has the clone's upstream branch moved on GitHub since the last fetch?
    {new: n commits | None, remote_sha} — needs a linked account."""
    up = clone.get("upstream") or ""
    remote = clone.get("remote") or "origin"
    if not up.startswith(remote + "/") or not clone.get("upstream_sha"):
        return None
    branch = up[len(remote) + 1:]
    repo = clone["repo"]
    try:
        sha, _, _ = github._cached(f"github:upstream:{repo.lower()}:{branch}", config.TTL_GITHUB_UPSTREAM,
                                   f"/repos/{repo}/commits/{branch}", accept="application/vnd.github.sha", raw=True)
    except github.GitHubError:
        return None
    sha = (sha or "").strip()
    if not sha or sha == clone["upstream_sha"]:
        return {"new": 0, "remote_sha": sha or None}
    try:
        cmp_, _, _ = github._cached(f"github:compare:{repo.lower()}:{clone['upstream_sha']}...{sha}", 86400,
                                    f"/repos/{repo}/compare/{clone['upstream_sha']}...{sha}",
                                    shape=lambda d: {"ahead_by": (d or {}).get("ahead_by"),
                                                     "status": (d or {}).get("status")})
        return {"new": cmp_.get("ahead_by"), "remote_sha": sha, "status": cmp_.get("status")}
    except github.GitHubError:
        return {"new": None, "remote_sha": sha}


def clones_with_upstream(check=False):
    items = [dict(c) for c in clones()]
    if check or github.account().get("linked"):
        with ThreadPoolExecutor(max_workers=6) as ex:
            for c, up in zip(items, ex.map(upstream, items)):
                c["upstream_status"] = up
    return items


def _clone_by_path(rel):
    for c in clones():
        if c["path"] == rel:
            return c
    return None


def fetch(rel):
    """`git fetch --prune` in one of the workspace's clones."""
    c = _clone_by_path(rel)
    if not c:
        raise github.GitHubError("That isn't one of the clones in the workspace.", 404, "not_found")
    path = config.EDITOR_ROOT / c["path"]
    try:
        code, _, err = _git(path, "fetch", "--prune", "--quiet", c.get("remote") or "origin", timeout=120)
    except subprocess.TimeoutExpired:
        raise github.GitHubError("git fetch took longer than two minutes and was stopped.", 504, "upstream") from None
    if code != 0:
        raise github.GitHubError(f"git fetch failed: {err.strip().splitlines()[-1] if err.strip() else code}", 502,
                                 "upstream")
    cache.invalidate(f"github:upstream:{c['repo'].lower()}:")
    fresh = inspect(path)
    with _scan_lock:
        _scan["items"] = None
    return fresh


# ── cloning ──────────────────────────────────────────────────────────────────

_jobs = {}
_jobs_lock = threading.Lock()
_PROGRESS = re.compile(r"(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|"
                       r"Checking out files|Filtering content):\s+(\d+)%")
_PHASE_WEIGHT = {"Counting objects": (0, 5), "Compressing objects": (5, 10), "Receiving objects": (10, 80),
                 "Resolving deltas": (80, 95), "Updating files": (95, 100), "Checking out files": (95, 100),
                 "Filtering content": (95, 100)}


def destination(repo):
    """Where a clone of 'owner/repo' goes: <root>/<repo>, or <root>/<repo>-<owner>
    when the plain name is taken. Raises if both are."""
    owner, name = github._split(repo).split("/")
    root = config.EDITOR_ROOT
    for candidate in (name, f"{name}-{owner}"):
        dest = (root / candidate).resolve()
        if dest.parent != root:
            raise github.GitHubError("That name would land outside the workspace.", 400, "invalid")
        if not dest.exists():
            return dest
    raise github.GitHubError(f"Both {name} and {name}-{owner} already exist in the workspace.", 409, "invalid")


def readme_in(dest):
    try:
        for p in sorted(dest.iterdir(), key=lambda p: (len(p.name), p.name.lower())):
            if p.is_file() and p.name.lower().startswith("readme"):
                return p
    except OSError:
        pass
    return None


def _open_target(dest):
    root = config.EDITOR_ROOT
    rd = readme_in(dest)
    return str((rd or dest).relative_to(root))


def start_clone(repo, private=False):
    if not available():
        raise github.GitHubError("git isn't available here.", 400, "invalid")
    repo = github._split(repo)
    existing = find(repo)
    if existing:
        dest = config.EDITOR_ROOT / existing["path"]
        return {"id": None, "state": "exists", "repo": repo, "path": existing["path"], "open": _open_target(dest)}
    dest = destination(repo)
    url = f"git@github.com:{repo}.git" if private else f"https://github.com/{repo}.git"
    job = {"id": uuid.uuid4().hex[:12], "state": "running", "repo": repo, "path": dest.name, "phase": "Starting",
           "percent": 0, "error": None, "open": None, "started_at": int(time.time())}
    with _jobs_lock:
        _jobs[job["id"]] = job
    threading.Thread(target=_run_clone, args=(job, url, dest), daemon=True).start()
    return dict(job)


def _run_clone(job, url, dest):
    try:
        proc = subprocess.Popen(["git", "clone", "--progress", "--filter=blob:none", url, str(dest)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env={**os.environ, **_ENV})
    except OSError as e:
        job.update(state="failed", error=str(e))
        return
    tail = []
    buf = b""
    while True:
        chunk = proc.stderr.read(256)
        if not chunk:
            break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            tail = (tail + [line])[-6:]
            m = _PROGRESS.search(line)
            if m:
                lo, hi = _PHASE_WEIGHT.get(m.group(1), (0, 100))
                job.update(phase=m.group(1), percent=max(job["percent"], int(lo + (hi - lo) * int(m.group(2)) / 100)))
    code = proc.wait()
    if code == 0 and dest.exists():
        job.update(state="done", percent=100, phase="Done", open=_open_target(dest))
        with _scan_lock:
            _scan["items"] = None
    else:
        msg = next((ln for ln in reversed(tail) if ln.startswith(("fatal:", "error:", "ERROR"))), tail[-1] if tail else "")
        job.update(state="failed", error=msg or f"git exited with {code}")
        if dest.exists() and not any(dest.iterdir()):
            shutil.rmtree(dest, ignore_errors=True)


def clone_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise github.GitHubError("No such clone.", 404, "not_found")
    return dict(job)


def editor_root_label():
    root = str(config.EDITOR_ROOT)
    home = str(Path.home())
    return "~" + root[len(home):] if root.startswith(home) else root
