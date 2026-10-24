"""By topic (its own module, which needs the Wire; shown with 3D objects on):
the front page's hundred hottest stories, sorted by the local AI into five
topics it names itself. A story that fits none of them is spiked, as a newsroom
spikes copy it won't run.

Two stages, like the Archive's ask(): one call reads all the headlines and names
the five topics that cover the most of them, then five calls of twenty put each
headline under one topic, or under none. Every answer is checked before it is
used (parse_topics, parse_sort), the Edition's rule: a bad answer is asked again
once; after that a batch goes on the spike marked jammed, or, at the naming
stage, the whole sort is jammed.

The work runs on a daemon thread. The API only reads `_state` (the sort under
way, rewritten after every batch so the machine can drop each batch as it lands)
and the last finished sort, kept in the cache table under KEY.
"""

import json
import re
import threading
import time

from .. import cache, config, modules
from ..brain import llm
from . import hackernews

KEY = "hn:topics"
TAKE = 100        # stories read off the front page
TOPICS = 5
BATCH = 20        # headlines per sorting call
DEADLINE = 360    # seconds; batches past it are spiked as jammed

# Names that would make a bin for everything, which is what the spike is for.
_CATCH_ALL = {"other", "others", "misc", "miscellaneous", "general", "technology",
              "tech", "news", "uncategorized", "uncategorised", "everything else"}

_NAME_SYSTEM = (
    "You sort a news wire into five desks. You are given today's Hacker News front "
    "page, numbered. Choose the five topics that together cover the most of these "
    "stories. Each topic must be specific enough to be useful (for example "
    '"Rust & systems", "AI models", "Space"), never a catch-all such as '
    '"Technology" or "Other", and no two may overlap. Return strict JSON: '
    '{"topics": [{"name": string (1 to 3 words), "about": string (at most 12 '
    'words)}]} with exactly five topics.'
)
_SORT_SYSTEM = (
    "You sort headlines into topics. For every numbered headline, give the number "
    "of the one topic it clearly belongs to, or 0 if it does not clearly fit any of "
    "them. Never force a headline into a topic. Return strict JSON: "
    '{"sort": {"<headline number>": <topic number, 0 to 5>}} covering every headline.'
)

_guard = threading.Lock()
_state = {"status": "idle", "stage": None, "done": 0, "total": 0,
          "partial": None, "jam": None}


class Jammed(Exception):
    """The sort stopped; the message is a sentence for the page."""


# ---- checking the model's answers (pure) ----

def _clean(name):
    s = " ".join(str(name or "").split())
    s = re.sub(r"^(?:\d+\s*[.):-]\s*|[-*•]\s*)", "", s)
    return s.strip(" \"'“”‘’`.:;,")


def parse_topics(text):
    """The naming answer → five {name, about}. Raises ValueError unless there are
    exactly five distinct, short, specific names."""
    data = json.loads(text)
    raw = data.get("topics") if isinstance(data, dict) else data
    if not isinstance(raw, list) or len(raw) != TOPICS:
        raise ValueError("not five topics")
    out, seen = [], set()
    for t in raw:
        if isinstance(t, str):
            name, about = t, ""
        elif isinstance(t, dict):
            name, about = t.get("name"), t.get("about")
        else:
            raise ValueError("topic is neither a name nor an object")
        name = _clean(name)
        if not name or len(name) > 32 or len(name.split()) > 4:
            raise ValueError(f"bad topic name {name!r}")
        if name.casefold() in _CATCH_ALL:
            raise ValueError(f"catch-all topic {name!r}")
        if name.casefold() in seen:
            raise ValueError(f"topic named twice {name!r}")
        seen.add(name.casefold())
        words = " ".join(str(about or "").split()).split()
        about = " ".join(words[:16]) + ("…" if len(words) > 16 else "")
        out.append({"name": name, "about": about})
    return out


def _topic_no(v):
    if isinstance(v, bool):
        return 0
    if isinstance(v, str) and v.strip().isdigit():
        v = int(v.strip())
    return v if isinstance(v, int) and 0 <= v <= TOPICS else 0


def parse_sort(text, n):
    """A sorting answer for `n` headlines → {headline 1..n: topic 0..5}, where 0
    is the spike. Anything unreadable for one headline counts as 0; an answer
    covering fewer than half of them raises ValueError (asked again)."""
    data = json.loads(text)
    raw = data.get("sort", data) if isinstance(data, dict) else data
    if isinstance(raw, list):
        raw = {i: v for i, v in enumerate(raw, start=1)}
    if not isinstance(raw, dict):
        raise ValueError("no sort in the answer")
    got = {}
    for k, v in raw.items():
        k = str(k).strip().strip("[]")
        if k.isdigit() and 1 <= int(k) <= n:
            got[int(k)] = _topic_no(v)
    if len(got) * 2 < n:
        raise ValueError(f"only {len(got)} of {n} headlines answered")
    return {i: got.get(i, 0) for i in range(1, n + 1)}


# ---- prompts ----

def _headlines(items):
    lines = []
    for i, s in enumerate(items, start=1):
        domain = (s.get("extra") or {}).get("domain")
        lines.append(f"[{i}] {s.get('title') or 'Untitled'}" + (f" ({domain})" if domain else ""))
    return "\n".join(lines)


def _name_prompt(items):
    return "Front page:\n\n" + _headlines(items) + "\n\nName the five topics now."


def _sort_prompt(topics, batch):
    desks = "\n".join(f"{i}. {t['name']}" + (f" — {t['about']}" if t["about"] else "")
                      for i, t in enumerate(topics, start=1))
    return (f"Topics:\n{desks}\n\nHeadlines:\n{_headlines(batch)}\n\n"
            "Sort every headline now (0 for none).")


def _ask(system, prompt, parse, model):
    """One question, asked again once if the answer doesn't pass `parse`; the
    second time the model is told what was wrong (small models often fix it)."""
    last, ask = None, prompt
    for _attempt in range(2):
        try:
            return parse(llm.chat(system, ask, model, temperature=0, fmt="json"))
        except Exception as e:  # unreachable Ollama, junk JSON, a failed check
            last = e
            ask = f"{prompt}\n\nYour last answer was refused: {e}. Answer again, following the rules."
    raise last


# ---- the sort ----

def _where():
    """Where the model is chosen, for a sentence."""
    return ("the Writer in Settings → The Edition" if modules.has("edition")
            else "the model in Settings → The Archive" if modules.has("archive") else "")


def readiness():
    """(model, problem): the model that sorts, and why it can't (None if it can)."""
    model = llm.chat_model()
    tags = llm.tags()
    if tags is None:
        return model, "Ollama isn't running, so nothing can read the headlines. Start it with `ollama serve`."
    if not llm.pulled(model, llm.writers(tags)):
        where = f", or change {_where()}" if _where() else ""
        return model, f"{model} isn't pulled. Run `ollama pull {model}`{where}."
    return model, None


def _payload(model, items, topics, bins, spiked, jammed, done):
    return {
        "sorted_at": int(time.time()),
        "model": model,
        "taken": len(items),
        "done": done,
        "topics": [{"n": i, "name": t["name"], "about": t["about"], "items": bins[i - 1]}
                   for i, t in enumerate(topics, start=1)] if topics else None,
        "spiked": spiked,
        "jammed": jammed,
    }


def sort(progress=lambda **kw: None):
    """Read the front page and sort it. Returns the finished payload; raises
    Jammed with a sentence when it can't. `progress(**state)` hears each step."""
    model, problem = readiness()
    if problem:
        raise Jammed(problem)
    try:
        items = hackernews.top_items(TAKE)
    except Exception as e:
        raise Jammed(f"Couldn't read the front page: {e}") from e
    if not items:
        raise Jammed("The front page came back empty.")
    t0 = time.monotonic()
    tape = [s.get("title") or "" for s in items]
    progress(stage="naming", total=len(items),
             partial={**_payload(model, items, None, [], [], 0, 0), "tape": tape})

    try:
        topics = _ask(_NAME_SYSTEM, _name_prompt(items), parse_topics, model)
    except Exception as e:
        bigger = f" A bigger model does better; change {_where()}." if _where() else ""
        raise Jammed(f"The sorter jammed: {model} didn't name five clear topics ({e}).{bigger}") from e

    bins, spiked, jammed = [[] for _ in topics], [], 0
    progress(stage="sorting", partial={**_payload(model, items, topics, bins, spiked, 0, 0), "tape": tape})
    for start in range(0, len(items), BATCH):
        batch = items[start:start + BATCH]
        answers = None
        if time.monotonic() - t0 < DEADLINE:
            try:
                answers = _ask(_SORT_SYSTEM, _sort_prompt(topics, batch),
                               lambda text, n=len(batch): parse_sort(text, n), model)
            except Exception:
                answers = None
        for i, story in enumerate(batch, start=1):
            k = answers[i] if answers else 0
            if k:
                bins[k - 1].append(story)
            else:
                slip = {"id": story["id"], "title": story.get("title") or "",
                        "rank": story["extra"].get("rank")}
                if answers is None:
                    slip["jammed"] = True
                spiked.append(slip)
        if answers is None:
            jammed += len(batch)
        done = start + len(batch)
        progress(done=done, partial={**_payload(model, items, topics, bins, spiked, jammed, done), "tape": tape})
    if jammed == len(items):
        raise Jammed(f"The sorter jammed: {model} couldn't sort the headlines into its topics.")
    return _payload(model, items, topics, bins, spiked, jammed, len(items))


def _run():
    try:
        result = sort(progress=lambda **kw: _state.update(kw))
        cache.put(KEY, result, config.TTL_HN_TOPICS)
        _state.update(status="idle", stage=None, partial=None, jam=None)
    except Jammed as e:
        _state.update(status="jammed", stage=None, partial=None, jam=str(e)[:400])
    except Exception as e:  # never let the thread die with the state stuck on sorting
        _state.update(status="jammed", stage=None, partial=None, jam=f"The sorter stopped: {e}"[:400])


def start():
    """Start a sort on its own thread. False if one is already running."""
    with _guard:
        if _state["status"] == "sorting":
            return False
        _state.update(status="sorting", stage="reading", done=0, total=0, partial=None, jam=None)
    threading.Thread(target=_run, daemon=True, name="tubcal-hn-topics").start()
    return True


def status():
    """What the page needs, read only: the sort under way, the last one finished,
    and whether the AI could sort now."""
    s = dict(_state)
    sorting = s["status"] == "sorting"
    model, problem = (llm.chat_model(), None) if sorting else readiness()
    result = cache.peek(KEY)
    return {
        "status": s["status"],
        "stage": s["stage"],
        "done": s["done"],
        "total": s["total"],
        "model": model,
        "ready": problem is None,
        "problem": problem,
        "jam": s["jam"],
        "partial": s["partial"] if sorting else None,
        "result": result,
        "stale": not result or time.time() - (result.get("sorted_at") or 0) >= config.TTL_HN_TOPICS,
    }
