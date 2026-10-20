"""The Archive — a local second brain over watched videos (transcription +
semantic search + on-device LLM summaries/digest/Q&A) — and The Edition's
build pipeline (cluster · feed_index · edition). Fully local; no data leaves
the machine.

The two are separate modules (modules.ini: archive, edition) and share only
llm.py, so nothing here is imported until it's asked for: import the part you
need (`from server.brain import edition`), never the package as a whole.
"""

from .. import modules


def start():
    """Spawn the background workers of whichever of the two is installed: the
    Archive's transcription/indexing worker and the Edition's daily press."""
    if modules.has("archive"):
        from . import worker
        worker.start()
    if modules.has("edition"):
        from . import edition
        edition.start()
