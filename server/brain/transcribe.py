"""Audio extraction (yt-dlp + ffmpeg) and speech-to-text (faster-whisper).

faster-whisper is imported lazily and the model is cached per size, so the base
app runs fine without the optional `brain` dependency group installed — the
worker simply reports the Archive as inactive (mirrors notifier's no-op).
"""

import ctypes
import glob

from .. import config

_models = {}  # (size, device) -> WhisperModel (loaded once, reused)
_cuda_ready = None

# ctranslate2 needs libcublas.so.12 at GPU compute time. Arch's system CUDA
# doesn't put it on the linker path, but Ollama bundles a copy — preload it (and
# cublasLt) into the global namespace so ctranslate2's dlopen-by-soname finds it.
# cuDNN 9 already lives in /usr/lib (on ldconfig's path), so it needs no help.
_CUDA_DIRS = (
    "/usr/local/lib/ollama/cuda_v12",
    "/opt/cuda/targets/x86_64-linux/lib",
    "/opt/cuda/lib64",
)


def _preload_cuda():
    """Best-effort: make cuBLAS loadable so the 4060 path works. Returns whether
    both libraries were preloaded (False → caller should use CPU)."""
    global _cuda_ready
    if _cuda_ready is not None:
        return _cuda_ready
    ok = True
    for name in ("libcublasLt.so.12", "libcublas.so.12"):
        loaded = False
        for base in _CUDA_DIRS:
            hits = glob.glob(f"{base}/{name}")
            if hits:
                try:
                    ctypes.CDLL(hits[0], mode=ctypes.RTLD_GLOBAL)
                    loaded = True
                    break
                except OSError:
                    pass
        ok = ok and loaded
    _cuda_ready = ok
    return ok


def whisper_available():
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def extract_audio(video_id):
    """Get a video's audio as a local file for transcription.

    Reuses the player's already-resolved (and cached) muxed stream rather than
    running a *second* yt-dlp download. That second extraction is what trips
    YouTube's "Sign in to confirm you're not a bot" wall — and reusing the signed
    URL also halves the requests we make to YouTube. The progressive mp4 (itag 18)
    carries audio, which is all whisper needs; we fetch its bytes through the same
    shared session the stream proxy uses (which googlevideo serves fine)."""
    from .. import httpc
    from ..sources import youtube

    config.BRAIN_DIR.mkdir(parents=True, exist_ok=True)
    info = youtube.video_info(video_id)
    streams = info.get("streams") or []
    mp4 = next((s for s in streams if s.get("kind") == "mp4" and s.get("url")), None)
    if not mp4:
        # Only HLS (live broadcasts / some members-only) — nothing to archive.
        raise RuntimeError("no downloadable audio for this video (live or restricted)")

    dest = config.BRAIN_DIR / f"{video_id}.mp4"
    with httpc.get(mp4["url"], stream=True, timeout=120) as r:
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 16):
                if chunk:
                    fh.write(chunk)
    return dest


def _load_model(size, device):
    key = (size, device)
    if key in _models:
        return _models[key]
    from faster_whisper import WhisperModel

    compute = "float16" if device == "cuda" else "int8"
    model = WhisperModel(size, device=device, compute_type=compute)
    _models[key] = model
    return model


def transcribe(audio_path, size="base"):
    """Return (lang, [{start, end, text}]) for an audio file. Prefers the GPU
    (RTX 4060) and transparently falls back to CPU if CUDA isn't usable — the
    fallback covers errors that only surface during inference, not construction."""
    devices = (["cuda", "cpu"] if _preload_cuda() else ["cpu"])
    last_err = None
    for device in devices:
        try:
            model = _load_model(size, device)
            segments, info = model.transcribe(str(audio_path), vad_filter=True)
            out = []
            for seg in segments:  # generator — GPU compute happens here
                text = (seg.text or "").strip()
                if text:
                    out.append({"start": float(seg.start), "end": float(seg.end),
                                "text": text})
            return (getattr(info, "language", None), out)
        except Exception as e:
            last_err = e
            _models.pop((size, device), None)
            continue
    raise last_err if last_err else RuntimeError("transcription failed")
