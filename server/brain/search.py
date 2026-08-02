"""Transcript chunking + brute-force cosine semantic search.

Embeddings are stored as packed float32 BLOBs in SQLite. At personal scale
(hundreds–few thousand chunks) a numpy dot-product over the whole corpus is
effectively instant, so there's no vector-DB dependency to manage.
"""

from .. import config, db
from . import llm


def chunk_segments(segments, max_seconds=None):
    """Group whisper segments into ~max_seconds windows, each carrying the start
    time of its first segment (the deep-link target). Returns
    [{idx, t_start, t_end, text}]."""
    max_seconds = max_seconds or config.BRAIN_CHUNK_SECONDS
    chunks = []
    cur, start, last = [], None, None
    for seg in segments:
        if start is None:
            start = seg["start"]
        cur.append(seg["text"])
        last = seg["end"]
        if last - start >= max_seconds:
            chunks.append({"idx": len(chunks), "t_start": start, "t_end": last,
                           "text": " ".join(cur).strip()})
            cur, start, last = [], None, None
    if cur:
        chunks.append({"idx": len(chunks), "t_start": start or 0, "t_end": last,
                       "text": " ".join(cur).strip()})
    return chunks


def pack_vector(vec):
    import numpy as np
    return np.asarray(vec, dtype="float32").tobytes()


def _unpack(blob):
    import numpy as np
    return np.frombuffer(blob, dtype="float32")


def embed_chunks(chunks, model):
    """Attach a packed-float32 `embedding` to each chunk in place. Returns the
    chunks; raises if Ollama/the embed model is unavailable (caller decides)."""
    vecs = llm.embed([c["text"] for c in chunks], model)
    for c, v in zip(chunks, vecs):
        c["embedding"] = pack_vector(v)
    return chunks


def rank_doc_chunks(item_id, query, model, k=6):
    """The parts of ONE video's transcript that bear on `query`, returned in
    transcript order (reading order beats score order for prose).

    Same cosine as `semantic_search`, scoped to a single doc — used by The
    Edition to quote the lead story's video without shipping the whole
    transcript. Returns [] whenever it can't (no embeddings, numpy or Ollama
    missing); callers treat that as "no transcript context available"."""
    try:
        import numpy as np
    except ImportError:
        return []

    rows = db.brain_doc_vectors(item_id)
    if not rows:
        return []
    try:
        qv = np.asarray(llm.embed([query], model)[0], dtype="float32")
    except Exception:
        return []
    qn = np.linalg.norm(qv) or 1.0

    scored = []
    for r in rows:
        v = _unpack(r["embedding"])
        if v.shape != qv.shape:
            continue
        score = float(qv.dot(v) / (qn * (np.linalg.norm(v) or 1.0)))
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = sorted(scored[:k], key=lambda x: x[1]["idx"])
    return [{"idx": r["idx"], "t_start": r["t_start"], "t_end": r["t_end"],
             "text": r["text"], "score": round(s, 4)} for s, r in top]


def semantic_search(query, model, k=None):
    """Rank stored chunks against a query embedding (cosine). Returns
    [{item_id, idx, t_start, t_end, snippet, title, source_name, thumbnail, score}]."""
    import numpy as np

    k = k or config.BRAIN_SEARCH_TOPK
    rows = db.brain_all_vectors()
    if not rows:
        return []
    qv = np.asarray(llm.embed([query], model)[0], dtype="float32")
    qn = np.linalg.norm(qv) or 1.0

    scored = []
    for r in rows:
        v = _unpack(r["embedding"])
        if v.shape != qv.shape:
            continue
        score = float(qv.dot(v) / (qn * (np.linalg.norm(v) or 1.0)))
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)

    out = []
    for score, r in scored[:k]:
        out.append({
            "item_id": r["item_id"],
            "idx": r["idx"],
            "t_start": r["t_start"],
            "t_end": r["t_end"],
            "snippet": r["text"],
            "title": r["title"],
            "source_name": r["source_name"],
            "thumbnail": r["thumbnail"],
            "score": round(score, 4),
        })
    return out
