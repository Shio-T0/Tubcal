"""The Archive — a local second brain over watched videos (transcription +
semantic search + on-device LLM summaries/digest/Q&A) — and The Edition's
build pipeline (cluster · feed_index · edition). Fully local; no data leaves
the machine."""

from . import cluster, edition, feed_index, llm, search, summarize, transcribe, worker


def start():
    """Spawn the background transcription/indexing worker."""
    worker.start()


__all__ = ["start", "cluster", "edition", "feed_index", "llm", "search",
           "summarize", "transcribe", "worker"]
