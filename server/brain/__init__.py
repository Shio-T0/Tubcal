"""The Archive — a local second brain over watched videos (transcription +
semantic search + on-device LLM summaries/digest/Q&A). Fully local; no data
leaves the machine."""

from . import llm, search, summarize, transcribe, worker


def start():
    """Spawn the background transcription/indexing worker."""
    worker.start()


__all__ = ["start", "llm", "search", "summarize", "transcribe", "worker"]
