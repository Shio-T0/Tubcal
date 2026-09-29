"""Background worker for the Archive: drains the transcription queue one doc at
a time (transcribe → chunk → embed → summarize → ready) and, when the user opts
in, auto-enqueues newly watched videos. Same daemon pattern as notifier.py."""

import threading
import time

from .. import config, db
from . import llm, search, summarize, transcribe

POLL_IDLE = 20    # seconds between checks when there's nothing to do
POLL_BUSY = 2     # short breather between docs when the queue is backed up


def _sweep_orphans():
    """Delete leftover audio downloads from a crashed/killed run.

    `_process` unlinks its download in a `finally`, but a SIGKILL mid-download
    skips that — leaving a full-video .mp4 (can be ~1 GB) stranded in BRAIN_DIR.
    Jobs run one at a time and none are in flight at startup, so every .mp4 here
    is dead weight and safe to remove."""
    try:
        for f in config.BRAIN_DIR.glob("*.mp4"):
            try:
                f.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _auto_enqueue():
    """If brain_auto_index is on, queue watched YouTube videos not yet indexed."""
    if not db.get_setting("brain_auto_index", False):
        return
    for row in db.get_history("youtube", limit=100):
        item_id = row["item_id"]
        if not item_id.startswith("yt:") or db.brain_get(item_id):
            continue
        vid = item_id[3:]
        db.brain_enqueue({
            "id": item_id,
            "platform": "youtube",
            "title": row.get("title"),
            "source": row.get("source_name"),
            "thumbnail": row.get("thumbnail"),
            "url": row.get("url"),
            "extra": {"video_id": vid, "channel_id": row.get("source_id")},
        })


def _process(doc):
    """Run one doc fully through the pipeline. Errors are recorded, not raised."""
    item_id = doc["item_id"]
    vid = item_id[3:] if item_id.startswith("yt:") else item_id
    audio = None
    try:
        db.brain_set_status(item_id, "transcribing")
        audio = transcribe.extract_audio(vid)
        size = db.get_setting("brain_whisper_model", "base")
        lang, segments = transcribe.transcribe(audio, size)
        if not segments:
            raise RuntimeError("no speech detected")

        full_text = " ".join(s["text"] for s in segments)
        duration = segments[-1]["end"] if segments else None
        db.brain_save_transcript(item_id, lang, full_text, duration)

        chunks = search.chunk_segments(segments)
        db.brain_set_status(item_id, "embedding")
        embed_model = db.get_setting("brain_embed_model", "nomic-embed-text")
        if llm.available() and llm.has_model(embed_model):
            try:
                search.embed_chunks(chunks, embed_model)
            except Exception:
                pass  # keep transcript + keyword search even if embedding fails
        db.brain_save_chunks(doc["id"], item_id, chunks)

        db.brain_mark_ready(item_id)

        # Best-effort summary so the digest + side panel have something to show.
        llm_model = db.get_setting("brain_llm_model", "qwen3.5:9b")
        if llm.available() and llm.has_model(llm_model):
            try:
                summarize.summary(item_id, llm_model)
            except Exception:
                pass
    except Exception as e:
        db.brain_set_status(item_id, "error", str(e)[:300])
    finally:
        if audio is not None:
            try:
                audio.unlink(missing_ok=True)
            except Exception:
                pass


def _loop():
    _sweep_orphans()  # reclaim any download stranded by a previous crash
    time.sleep(30)  # let startup settle (matches notifier)
    while True:
        delay = POLL_IDLE
        try:
            if db.get_setting("brain_enabled", True) and transcribe.whisper_available():
                _auto_enqueue()
                doc = db.brain_next_queued()
                if doc:
                    _process(doc)
                    delay = POLL_BUSY
        except Exception:
            pass
        time.sleep(delay)


def start():
    """Spawn the background worker (no-op without faster-whisper installed)."""
    if not transcribe.whisper_available():
        return
    threading.Thread(target=_loop, daemon=True, name="tubcal-brain").start()
