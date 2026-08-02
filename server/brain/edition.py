"""The Edition (No 00): builds one daily paper from everything the station
receives — cluster the same story across platforms, rank it, write it up.

Everything here runs in a background thread. The reader-facing API only ever
reads a pre-built row from the `editions` table; no request ever waits on
embedding, clustering, or an LLM.

Degradation ladder (each level fully usable):
  - nothing installed        -> "wire" edition: hard-link clusters, template prose
  - numpy + embed model      -> semantic clusters, template prose
  - + chat model             -> "edited": grounded synthesis with citations
"""

import json
import threading
import time

from .. import config, db
from . import cluster, feed_index, llm, search

POLL_SECONDS = 600        # builder heartbeat (one paper a day, like a paper)
SYNTH_DEADLINE = 240      # seconds of LLM budget per build before templating the rest
_ROOMS = {"youtube": "the Screening Room", "reddit": "the Dispatch",
          "hackernews": "the Wire"}

_build_lock = threading.Lock()
_state = {"building": False, "last_error": None}

_SYNTH_SYSTEM = (
    "You are the copy desk of a private broadsheet. Write one story from the "
    "provided source items. Use ONLY facts present in the items — never invent "
    "numbers, names, or events. Return strict JSON: "
    '{"headline": string (at most 12 words), "dek": string (one sentence), '
    '"body": string (60-120 words), "cited": [item numbers actually used]}. '
    "Voice: calm, concrete, specific. No hype, no 'in this video' filler."
)
_SYNTH_TRANSCRIPT_NOTE = (
    " One item may carry a TRANSCRIPT block: what was actually said in that "
    "source, taken from the reader's own archive. Treat it as the strongest "
    "evidence you have — report what the speaker said and the specifics they "
    "gave, rather than paraphrasing the title. Cite it under that item's number; "
    "timestamps are there to orient you and must not appear in the prose."
)


# ---- story text ----

def _age(published_at, now):
    h = max(0, int((now - (published_at or now)) // 3600))
    return f"{h}h ago" if h < 24 else f"{h // 24}d ago"


def _rank_items(items):
    return sorted(
        items,
        key=lambda i: ((i.get("score") or 0) + 0.5 * (i.get("comments_count") or 0),
                       i.get("published_at") or 0),
        reverse=True,
    )


def _strip(item):
    """Payload copy of an item: everything the UI needs to render + open it
    on its native surface, minus build-time scratch fields."""
    out = {k: v for k, v in item.items() if k != "snippet"}
    return out


def _template_story(items, salience_score):
    """The no-LLM story (and the fallback when synthesis misbehaves)."""
    ranked = _rank_items(items)
    top = ranked[0]
    rooms = []
    for i in ranked:
        room = _ROOMS.get(i.get("platform"))
        if room and room not in rooms:
            rooms.append(room)
    dek = ""
    if len(rooms) > 1:
        dek = f"The same story surfaced in {' and '.join(rooms)}."
    body = " — ".join(
        s for s in (i.get("snippet") for i in ranked[:3]) if s
    )[:config.EDITION_SNIPPET]
    return {
        "headline": top.get("title") or "Untitled",
        "dek": dek,
        "body": body,
        "cited": [],
        "synthesized": False,
        "salience": round(salience_score, 3),
        "items": [_strip(i) for i in ranked],
    }


def _validate_synthesis(text, n_items):
    """The gate that keeps a local 8B model honest: strict JSON, fields
    present, sane lengths, and every citation pointing at a provided item."""
    data = json.loads(text)
    headline = str(data.get("headline") or "").strip()
    dek = str(data.get("dek") or "").strip()
    body = str(data.get("body") or "").strip()
    cited = data.get("cited") or []
    if not headline or not body:
        raise ValueError("missing headline/body")
    if len(headline.split()) > 16:
        raise ValueError("headline too long")
    words = len(body.split())
    if not 20 <= words <= 180:
        raise ValueError(f"body out of bounds ({words} words)")
    if not isinstance(cited, list) or not cited:
        raise ValueError("no citations")
    cited = [int(c) for c in cited]
    if not set(cited) <= set(range(1, n_items + 1)):
        raise ValueError("citation outside provided items")
    return headline, dek, body, cited


def _clock(seconds):
    s = max(int(seconds or 0), 0)
    return f"{s // 60}:{s % 60:02d}"


def _transcript_block(ranked, headline, embed_model):
    """The Archive's record of this story's video, if it holds one.

    A feed item gives the copy desk a title and whatever description the
    platform felt like publishing; the transcript gives it the thing itself. So
    for the lead story we look up the top-ranked item that has already been
    transcribed and quote the parts that bear on the headline — the relevant
    parts, not the opening minutes, since the vectors are already sitting there.

    Returns (block_text, item_number) or (None, None). Never raises: the paper
    goes out with or without this."""
    for n, i in enumerate(ranked, start=1):
        item_id = i.get("id")
        if not item_id:
            continue
        try:
            doc = db.brain_get(item_id)
        except Exception:
            return None, None
        if not doc or doc.get("status") != "ready":
            continue

        parts = []
        if doc.get("summary"):
            parts.append("Summary: " + " ".join(doc["summary"].split()))

        picks = []
        if embed_model:
            try:
                picks = search.rank_doc_chunks(
                    item_id, headline, embed_model, k=config.EDITION_TRANSCRIPT_CHUNKS)
            except Exception:
                picks = []
        if picks:
            parts += [f"{_clock(p['t_start'])} — {' '.join(p['text'].split())}"
                      for p in picks]
        elif doc.get("transcript"):
            # No usable vectors: fall back to the opening, which at least
            # states what the video is about.
            parts.append(" ".join(doc["transcript"].split())
                         [:config.EDITION_TRANSCRIPT_CHARS] + "…")
        if not parts:
            continue

        body = "\n".join(parts)[:config.EDITION_TRANSCRIPT_CHARS]
        head = (f"TRANSCRIPT of [{n}] — what was actually said in "
                f"\"{doc.get('title') or i.get('title') or 'Untitled'}\":")
        return f"{head}\n{body}", n
    return None, None


def _synthesize_story(items, salience_score, model, now, embed_model=None):
    """Grounded synthesis for one cluster; template fallback on any failure.

    `embed_model` is passed only for the lede, and only enables the transcript
    block — synthesis itself is identical for every story."""
    ranked = _rank_items(items)[:6]  # keep the prompt small — no num_ctx games
    lines = []
    for n, i in enumerate(ranked, start=1):
        bits = [i.get("platform") or "?", i.get("source") or "?",
                _age(i.get("published_at"), now)]
        line = f"[{n}] ({' · '.join(bits)}) {i.get('title') or 'Untitled'}"
        if i.get("snippet"):
            line += f" — {i['snippet']}"
        lines.append(line)
    prompt = "Story items:\n\n" + "\n\n".join(lines)

    system, sourced = _SYNTH_SYSTEM, None
    if embed_model is not None:
        block, sourced = _transcript_block(ranked, ranked[0].get("title") or "", embed_model)
        if block:
            prompt += "\n\n" + block
            system += _SYNTH_TRANSCRIPT_NOTE
    prompt += "\n\nWrite the story JSON now."

    for _attempt in range(2):  # one retry, then template — never a blocked build
        try:
            text = llm.chat(system, prompt, model,
                            temperature=0.15, fmt="json")
            headline, dek, body, cited = _validate_synthesis(text, len(ranked))
            return {
                "headline": headline,
                "dek": dek,
                "body": body,
                "cited": [ranked[c - 1]["id"] for c in cited],
                "synthesized": True,
                # Which item (if any) the copy desk read in full, not just billed.
                "transcript_of": ranked[sourced - 1]["id"] if sourced else None,
                "salience": round(salience_score, 3),
                "items": [_strip(i) for i in _rank_items(items)],
            }
        except Exception:
            continue
    return _template_story(items, salience_score)


def _brief(items, salience_score):
    ranked = _rank_items(items)
    return {
        "headline": ranked[0].get("title") or "Untitled",
        "salience": round(salience_score, 3),
        "items": [_strip(i) for i in ranked],
    }


# ---- the build ----

def _numpy_ok():
    try:
        import numpy  # noqa: F401
        return True
    except ImportError:
        return False


def _chat_model():
    return (db.get_setting("edition_llm_model", "")
            or db.get_setting("brain_llm_model", "llama3.1:8b"))


def build(force=False):
    """Compose today's paper. Returns True if a paper was built. Never raises —
    the builder thread and the rebuild endpoint both call this blind."""
    if not _build_lock.acquire(blocking=False):
        return False  # a build is already running
    _state["building"] = True
    _state["last_error"] = None
    try:
        return _build()
    except Exception as e:
        _state["last_error"] = str(e)[:300]
        return False
    finally:
        _state["building"] = False
        _build_lock.release()


def _build():
    t0 = time.monotonic()
    now = time.time()
    date = time.strftime("%Y-%m-%d", time.localtime(now))

    items = feed_index.collect_items()
    if not items:
        return False  # nothing followed / all sources down — leave the presses cold

    # Ladder rung 1 -> 2: embeddings, if the local stack is up.
    vectors = None
    embed_model = db.get_setting("brain_embed_model", "nomic-embed-text")
    if _numpy_ok() and llm.available() and llm.has_model(embed_model):
        try:
            feed_index.index_new(items, embed_model)
            vectors = feed_index.vectors_for(items, embed_model)
        except Exception:
            vectors = None  # wire-quality clustering still stands

    clusters = cluster.cluster(items, vectors, config.EDITION_SIM)

    subs = {s["source_id"] for s in db.list_subscriptions()}
    hist = {h["source_id"] for h in db.get_history(limit=200) if h.get("source_id")}
    scored = sorted(
        ({"salience": cluster.salience(c["items"], subs, hist, now),
          "items": c["items"]} for c in clusters),
        key=lambda c: c["salience"],
        reverse=True,
    )
    slots = cluster.layout(scored)

    # Ladder rung 2 -> 3: synthesis, hard-capped and time-boxed.
    chat_model = _chat_model()
    chat_ok = llm.available() and llm.has_model(chat_model)

    def write(c, budget_left, lead=False):
        if chat_ok and budget_left:
            # Only the lede gets the transcript treatment: it is the one story
            # worth the extra context, and `vectors` proves the embed stack is up.
            return _synthesize_story(c["items"], c["salience"], chat_model, now,
                                     embed_model if (lead and vectors is not None) else None)
        return _template_story(c["items"], c["salience"])

    to_write = ([slots["lede"]] if slots["lede"] else []) + slots["columns"]
    to_write = to_write[:config.EDITION_MAX_SYNTH + 1]
    stories = []
    for c in to_write:
        in_budget = (time.monotonic() - t0) < SYNTH_DEADLINE and \
            len([s for s in stories if s.get("synthesized")]) < config.EDITION_MAX_SYNTH
        stories.append(write(c, in_budget, lead=(not stories and bool(slots["lede"]))))

    lede = stories[0] if slots["lede"] and stories else None
    columns = stories[1:] if slots["lede"] else stories
    briefs = [_brief(c["items"], c["salience"]) for c in slots["briefs"]]

    status = "edited" if any(s.get("synthesized") for s in stories) else "wire"
    build_ms = int((time.monotonic() - t0) * 1000)

    known = db.edition_list(365)
    issue = len(known) + (0 if any(e["date"] == date for e in known) else 1)

    payload = {
        "date": date,
        "issue": issue,
        "status": status,
        "model": chat_model if status == "edited" else None,
        "generated_at": int(now),
        "build_ms": build_ms,
        "sources": len(items),
        "window_h": config.EDITION_WINDOW_H,
        "lede": lede,
        "columns": columns,
        "briefs": briefs,
    }
    db.edition_save(date, status, payload["model"], len(items), build_ms, payload)
    return True


def status():
    latest = db.edition_list(1)
    return {
        "building": _state["building"],
        "last_error": _state["last_error"],
        "latest": latest[0] if latest else None,
        "hour": db.get_setting("edition_hour", 6),
    }


def rebuild_async():
    """Fire a build on a one-shot thread so the API returns immediately."""
    threading.Thread(target=build, kwargs={"force": True},
                     daemon=True, name="tubcal-edition-rebuild").start()


# ---- builder thread (same daemon shape as notifier.py) ----

def _should_build():
    if not db.get_setting("edition_enabled", True):
        return False
    if time.localtime().tm_hour < int(db.get_setting("edition_hour", 6)):
        return False  # yesterday's paper stands overnight
    latest = db.edition_list(1)
    today = time.strftime("%Y-%m-%d")
    return not latest or latest[0]["date"] != today


def _loop():
    time.sleep(45)  # let startup warm-up and the notifier settle first
    while True:
        try:
            if _should_build():
                build()
        except Exception:
            pass
        time.sleep(POLL_SECONDS)


def start():
    """Spawn the builder. Unconditional — wire editions need no ML wheels."""
    threading.Thread(target=_loop, daemon=True, name="tubcal-edition").start()
