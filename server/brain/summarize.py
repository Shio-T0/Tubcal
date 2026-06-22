"""LLM features over the Archive: per-video summaries, a feed digest, and
retrieval-augmented "ask my feed" Q&A. All run on the local Ollama model."""

import time

from .. import cache, config, db
from . import llm, search

_SUMMARY_SYSTEM = (
    "You summarize video transcripts for a personal archive. Be faithful, concise "
    "and concrete. No preamble, no 'this video' filler."
)
_DIGEST_SYSTEM = (
    "You are the editor of a private daily brief. Given short notes from several "
    "videos the reader recently watched, write a warm, tight digest of what's worth "
    "remembering. Group related themes. No fluff."
)
_ASK_SYSTEM = (
    "You answer questions using ONLY the provided transcript excerpts from the "
    "reader's own watched videos. Cite sources inline as [n]. If the excerpts don't "
    "contain the answer, say so plainly. Be concise."
)


def summary(item_id, llm_model):
    """Generate (and persist) a TL;DR for one indexed video. Returns the text."""
    doc = db.brain_get(item_id)
    if not doc or not doc.get("transcript"):
        raise RuntimeError("no transcript to summarize")
    transcript = doc["transcript"][:16000]  # keep the prompt within context
    prompt = (
        f"Title: {doc.get('title') or 'Untitled'}\n"
        f"Channel: {doc.get('source_name') or 'unknown'}\n\n"
        "Write a 3–6 sentence TL;DR, then 3–5 bullet takeaways.\n\n"
        f"Transcript:\n{transcript}"
    )
    text = llm.chat(_SUMMARY_SYSTEM, prompt, llm_model)
    if text:
        db.brain_set_summary(item_id, text)
    return text


def digest(window, llm_model):
    """A cached editorial digest of videos indexed in the last day/week."""
    window = "day" if window not in ("day", "week") else window
    seconds = 86400 if window == "day" else 7 * 86400

    def build():
        docs = db.brain_ready_since(time.time() - seconds)
        if not docs:
            return {"text": "", "count": 0, "window": window}
        notes = []
        for d in docs:
            note = d.get("summary") or (d.get("transcript") or "")[:600]
            notes.append(f"• {d.get('title') or 'Untitled'} "
                         f"({d.get('source_name') or '—'}): {note}")
        prompt = ("Notes from recently watched videos:\n\n"
                  + "\n\n".join(notes[:30])
                  + "\n\nWrite the digest now.")
        text = llm.chat(_DIGEST_SYSTEM, prompt, llm_model)
        return {"text": text, "count": len(docs), "window": window}

    payload, _stale = cache.cached_swr(
        f"brain:digest:{window}", config.TTL_BRAIN_DIGEST, build
    )
    return payload


def ask(question, embed_model, llm_model, k=8):
    """RAG over the archive: retrieve top chunks, answer with citations.
    Returns {answer, citations:[{n, item_id, title, t_start}]}."""
    hits = search.semantic_search(question, embed_model, k=k)
    if not hits:
        return {"answer": "", "citations": [], "empty": True}

    blocks, citations = [], []
    for i, h in enumerate(hits, start=1):
        ts = int(h["t_start"] or 0)
        blocks.append(
            f"[{i}] {h['title'] or 'Untitled'} @ {ts // 60}:{ts % 60:02d}\n{h['snippet']}"
        )
        citations.append({
            "n": i,
            "item_id": h["item_id"],
            "title": h["title"],
            "source_name": h["source_name"],
            "thumbnail": h["thumbnail"],
            "t_start": h["t_start"],
        })
    prompt = (f"Question: {question}\n\nExcerpts:\n\n" + "\n\n".join(blocks)
              + "\n\nAnswer with inline [n] citations.")
    answer = llm.chat(_ASK_SYSTEM, prompt, llm_model)
    return {"answer": answer, "citations": citations}
