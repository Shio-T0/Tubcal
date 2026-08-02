"""LLM features over the Archive: per-video summaries, a feed digest, and
retrieval-augmented "ask my feed" Q&A. All run on the local Ollama model."""

import json
import time

import requests

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
    "reader's own watched videos. Each excerpt opens with [n], its video title and "
    "channel, then an indented context line (where in the video it sits, how long "
    "the video is, when the reader watched it, retrieval relevance) and, the first "
    "time a video appears, a one-line summary of that whole video. The transcript "
    "text follows. Treat those context lines as metadata about the source, never as "
    "something the speaker said. Several excerpts may come from the same video — say "
    "so rather than presenting them as separate sources. Cite sources inline as [n]. "
    "If the excerpts don't contain the answer, say so plainly. Be concise."
)
_SELECT_SYSTEM = (
    "You triage search results. Given a question and numbered transcript excerpts, "
    "name the few most likely to hold the answer — or to be cut off just before it, "
    "since each excerpt is a 45-second window and the surrounding transcript can be "
    "fetched for the ones you pick. Answer with JSON only, no prose."
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


def _clock(seconds):
    """Seconds → m:ss (or h:mm:ss past an hour)."""
    s = max(int(seconds or 0), 0)
    if s >= 3600:
        return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"
    return f"{s // 60}:{s % 60:02d}"


def _day(ts):
    return time.strftime("%Y-%m-%d", time.localtime(int(ts))) if ts else None


def _one_line(text, limit=320):
    """Collapse a multi-line summary so it can't be mistaken for transcript."""
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[:limit].rstrip() + "…"


def _excerpt(n, hit, meta, first_of_video, window=None):
    """One numbered excerpt: header, context line, optional video summary, text.

    `window` is the zoom pass's result — {text, t_start, t_end, chunks} covering
    the neighbouring chunks too. When present it replaces the 45-second snippet."""
    title = hit.get("title") or meta.get("title") or "Untitled"
    channel = hit.get("source_name") or meta.get("source_name") or "unknown channel"

    start = window["t_start"] if window else hit.get("t_start")
    end = window["t_end"] if window else hit.get("t_end")
    span = f"{_clock(start)}–{_clock(end)}"
    duration = meta.get("duration")
    facts = [f"{span} of {_clock(duration)}" if duration else span]

    idx, total = hit.get("idx"), meta.get("chunk_count")
    if idx is not None and total:
        facts.append(f"part {idx + 1}/{total}")
    if window:
        facts.append(f"expanded to {window['chunks']} consecutive parts")
    watched, indexed = _day(meta.get("watched_at")), _day(meta.get("indexed_at"))
    if watched:
        facts.append(f"watched {watched}")
    elif indexed:
        facts.append(f"archived {indexed}")
    if (meta.get("watch_count") or 0) > 1:
        facts.append(f"rewatched ×{meta['watch_count']}")
    if meta.get("lang"):
        facts.append(f"lang {meta['lang']}")
    if hit.get("score") is not None:
        facts.append(f"relevance {hit['score']:.2f}")

    lines = [f"[{n}] {title} — {channel}", "    " + " · ".join(facts)]
    if first_of_video and meta.get("summary"):
        lines.append("    Whole video: " + _one_line(meta["summary"]))
    lines.append(window["text"] if window else hit["snippet"])
    return "\n".join(lines)


def _choose(question, blocks, llm_model, count, limit):
    """Ask the model which excerpts deserve a closer read. Returns 1-based
    positions, at most `limit`. Any malformed answer falls back to the
    highest-scoring excerpts, so a confused model costs relevance, never the
    answer itself."""
    default = list(range(1, min(limit, count) + 1))
    prompt = (f"Question: {question}\n\nExcerpts:\n\n" + "\n\n".join(blocks)
              + f"\n\nWhich at most {limit} excerpts are most likely to contain the "
                f"answer, or to continue into it? Reply with JSON only: "
                f'{{"expand": [n, ...]}}')
    try:
        raw = llm.chat(_SELECT_SYSTEM, prompt, llm_model, temperature=0, fmt="json")
        picked = json.loads(raw).get("expand")
    except (ValueError, TypeError, AttributeError, requests.RequestException):
        return default
    if not isinstance(picked, list):
        return default
    clean = []
    for n in picked:
        if isinstance(n, bool) or not isinstance(n, int):
            continue
        if 1 <= n <= count and n not in clean:
            clean.append(n)
    return clean[:limit] or default


def _window(hit, radius, taken):
    """Pull the chunks around a hit, skipping any another excerpt already shows,
    so the same passage is never sent twice. None if there's nothing to add."""
    idx = hit.get("idx")
    if idx is None:
        return None
    rows = db.brain_chunk_window(hit["item_id"], idx, radius)
    kept = [r for r in rows if r["idx"] == idx or (hit["item_id"], r["idx"]) not in taken]
    if len(kept) <= 1:
        return None
    for r in kept:
        taken.add((hit["item_id"], r["idx"]))
    return {
        "text": " ".join(r["text"] for r in kept),
        "t_start": kept[0]["t_start"],
        "t_end": kept[-1]["t_end"],
        "chunks": len(kept),
    }


def ask(question, embed_model, llm_model, k=8):
    """RAG over the archive: retrieve top chunks, let the model pick the few
    worth reading in full, then answer with citations.
    Returns {answer, citations:[{n, item_id, title, t_start}], expanded:[n]}."""
    hits = search.semantic_search(question, embed_model, k=k)
    if not hits:
        return {"answer": "", "citations": [], "empty": True}

    # One small lookup for the handful of videos the hits came from — channel,
    # length, watch date and TL;DR, so each excerpt arrives with its provenance.
    ctx = db.brain_context([h["item_id"] for h in hits])
    metas = [ctx.get(h["item_id"]) or {} for h in hits]

    def render(windows):
        seen, out = set(), []
        for i, (h, meta) in enumerate(zip(hits, metas), start=1):
            out.append(_excerpt(i, h, meta, h["item_id"] not in seen, windows.get(i)))
            seen.add(h["item_id"])
        return out, seen

    blocks, videos = render({})

    # Zoom pass: retrieval hands back a 45-second keyhole per hit, and the model
    # is a better judge than cosine of which keyholes are worth widening.
    expanded = []
    limit = config.BRAIN_ASK_EXPAND
    if limit and len(hits) > 1:
        # Every hit already shows its own chunk — reserve those so a window only
        # ever contributes text the model isn't being given elsewhere.
        taken = {(h["item_id"], h["idx"]) for h in hits if h.get("idx") is not None}
        windows = {}
        for n in _choose(question, blocks, llm_model, len(hits), limit):
            w = _window(hits[n - 1], config.BRAIN_ASK_EXPAND_RADIUS, taken)
            if w:
                windows[n] = w
        if windows:
            blocks, videos = render(windows)
            expanded = sorted(windows)

    citations = [{
        "n": i,
        "item_id": h["item_id"],
        "title": h["title"],
        "source_name": h["source_name"],
        "thumbnail": h["thumbnail"],
        "t_start": h["t_start"],
    } for i, h in enumerate(hits, start=1)]

    prompt = (f"Question: {question}\n\n"
              f"Excerpts (from {len(videos)} video(s) in the reader's archive):\n\n"
              + "\n\n".join(blocks)
              + "\n\nAnswer with inline [n] citations.")
    answer = llm.chat(_ASK_SYSTEM, prompt, llm_model)
    return {"answer": answer, "citations": citations, "expanded": expanded}
