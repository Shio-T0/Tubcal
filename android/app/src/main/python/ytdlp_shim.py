"""yt-dlp as a "binary", for a phone that has none.

The desktop server shells out to the system `yt-dlp` (`shutil.which("yt-dlp")` →
`subprocess.run([exe, "-J", …, url])` → JSON on stdout). Android has no binary to
exec, but Chaquopy bundles the yt-dlp *library* — the same extractor. Rather than
fork server/sources/youtube.py for the phone (and re-patch it on every sync), we
hand that one module a `shutil` whose `which("yt-dlp")` answers, and a
`subprocess` whose `run()` recognises that answer and runs the library in-process:
the argv goes through yt-dlp's own option parser, so every flag the desktop passes
(-J, --flat-playlist, --playlist-end, --add-header, --ignore-no-formats-error…)
means exactly what it means on the command line. The result comes back as a
CompletedProcess with the JSON on stdout, so the calling code can't tell.

Everything else falls through to the real modules.
"""

import io
import json
import shutil as _shutil
import subprocess as _subprocess
import sys
import threading
import types

FAKE_EXE = "/tubcal/bin/yt-dlp"  # never exec'd; a marker run() recognises

# Options that make the CLI print or write things; in-process we only want the info.
_DROP = (
    "dump_single_json", "dumpjson", "forcejson", "forceprint", "print_to_file", "simulate",
    "forceurl", "forcetitle", "forceid", "forcethumbnail", "forcedescription", "forcefilename",
    "forceduration", "progress_with_newline", "consoletitle", "outtmpl",
)


def _extract(argv):
    import yt_dlp

    parsed = yt_dlp.parse_options(list(argv))
    opts = dict(parsed.ydl_opts)
    for k in _DROP:
        opts.pop(k, None)
    opts.update({
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": True,
        # Android has no writable ~/.cache; yt-dlp would try to keep its player
        # signature cache there and fail.
        "cachedir": False,
        "socket_timeout": opts.get("socket_timeout") or 20,
    })
    out = []
    with yt_dlp.YoutubeDL(opts) as ydl:
        for url in parsed.urls:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise RuntimeError(f"no info for {url}")
            out.append(ydl.sanitize_info(info))
    return out[0] if len(out) == 1 else out


def run(args, *pargs, timeout=None, text=False, capture_output=False, **kw):
    """subprocess.run, except a call to FAKE_EXE runs yt-dlp in-process."""
    if not (isinstance(args, (list, tuple)) and args and args[0] == FAKE_EXE):
        return _subprocess.run(args, *pargs, timeout=timeout, text=text, capture_output=capture_output, **kw)

    box = {}

    def work():
        try:
            box["data"] = _extract(args[1:])
        except SystemExit as e:  # the option parser exits on a bad flag
            box["err"] = f"yt-dlp: bad arguments ({e})"
        except BaseException as e:  # noqa: BLE001 — report it the way a failed process would
            box["err"] = f"ERROR: {e}"

    t = threading.Thread(target=work, daemon=True, name="yt-dlp")
    t.start()
    t.join(timeout)
    if t.is_alive():
        # Can't kill a thread; let it finish in the background and report the timeout
        # the way subprocess would, so callers' error handling is unchanged.
        raise _subprocess.TimeoutExpired(args, timeout)
    if "err" in box:
        stdout, stderr, code = "", box["err"], 1
    else:
        stdout, stderr, code = json.dumps(box["data"]), "", 0
    if not text:
        stdout, stderr = stdout.encode(), stderr.encode()
    return _subprocess.CompletedProcess(args, code, stdout, stderr)


def which(cmd, *a, **kw):
    if cmd == "yt-dlp":
        try:
            import yt_dlp  # noqa: F401
            return FAKE_EXE
        except Exception:
            return None
    return _shutil.which(cmd, *a, **kw)


def _module(real, **overrides):
    m = types.ModuleType(real.__name__)
    m.__dict__.update({k: getattr(real, k) for k in dir(real) if not k.startswith("__")})
    m.__dict__.update(overrides)
    return m


def install():
    """Give server.sources.youtube the shimmed shutil/subprocess. Idempotent."""
    from server.sources import youtube

    if getattr(youtube.subprocess, "_tubcal_shim", False):
        return
    sub = _module(_subprocess, run=run, _tubcal_shim=True)
    youtube.subprocess = sub
    youtube.shutil = _module(_shutil, which=which)


if __name__ == "__main__":  # quick self-test: python ytdlp_shim.py VIDEO_ID
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    vid = sys.argv[1] if len(sys.argv) > 1 else "jNQXAC9IVRw"
    p = run([FAKE_EXE, "-J", "--no-warnings", "--no-playlist", "--ignore-no-formats-error",
             f"https://www.youtube.com/watch?v={vid}"], capture_output=True, text=True, timeout=90)
    print(p.returncode, (p.stderr or "")[:200])
    d = json.loads(p.stdout) if p.returncode == 0 else {}
    print(d.get("title"), len(d.get("formats") or []), "formats")
