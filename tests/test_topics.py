"""By topic: the checks on the model's answers, the sort with the model and the
front page stubbed, and the API that only reads."""

import json

import pytest

from server import cache
from server.brain import llm
from server.sources import hackernews, hn_topics


def _stories(n):
    return [{"id": f"hn:{i}", "title": f"Story {i}", "platform": "hackernews",
             "extra": {"hn_id": i, "domain": "example.com", "rank": i}} for i in range(1, n + 1)]


TOPICS = {"topics": [{"name": n, "about": f"About {n}"} for n in
                     ("AI models", "Rust & systems", "Space", "Security", "Hardware")]}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    # the cache's memory layer and the job state outlive a test's throwaway DB
    monkeypatch.setattr(hn_topics, "_state", dict(hn_topics._state, status="idle", partial=None, jam=None))
    monkeypatch.setattr(cache, "_mem", type(cache._mem)())


@pytest.fixture
def ready(monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "has_model", lambda m: True)
    monkeypatch.setattr(llm, "chat_model", lambda: "test-model")


# ---- parse_topics ----

def test_topics_cleaned_and_kept_in_order():
    raw = {"topics": [{"name": "1. AI models", "about": "  New   models "}, {"name": '"Space"'},
                      "Rust", {"name": "- Security."}, {"name": "Hardware"}]}
    got = hn_topics.parse_topics(json.dumps(raw))
    assert [t["name"] for t in got] == ["AI models", "Space", "Rust", "Security", "Hardware"]
    assert got[0]["about"] == "New models" and got[1]["about"] == ""


@pytest.mark.parametrize("raw", [
    {"topics": [{"name": "A"}] * 4},                                     # four
    {"topics": [{"name": n} for n in ("A", "B", "C", "D", "E", "F")]},  # six
    {"topics": [{"name": n} for n in ("A", "a", "C", "D", "E")]},       # the same name twice
    {"topics": [{"name": n} for n in ("A", "B", "C", "D", "Other")]},   # a catch-all bin
    {"topics": [{"name": n} for n in ("A", "B", "C", "D", "")]},        # an empty name
    {"topics": [{"name": n} for n in ("A", "B", "C", "D", "far too many words in it")]},
    {"desks": []},
])
def test_topics_refused(raw):
    with pytest.raises(ValueError):
        hn_topics.parse_topics(json.dumps(raw))


def test_topics_refuse_junk():
    with pytest.raises(ValueError):
        hn_topics.parse_topics("Sure! Here are five topics:")


def test_about_trimmed_to_sixteen_words():
    raw = {"topics": [{"name": n, "about": "word " * 30} for n in "ABCDE"]}
    assert hn_topics.parse_topics(json.dumps(raw))[0]["about"].endswith("word…")


# ---- parse_sort ----

def test_sort_reads_numbers_and_spikes_the_rest():
    got = hn_topics.parse_sort(json.dumps({"sort": {"1": 2, "2": "5", "3": 0, "4": 9, "5": "x", "[6]": 1}}), 7)
    assert got == {1: 2, 2: 5, 3: 0, 4: 0, 5: 0, 6: 1, 7: 0}


def test_sort_without_its_wrapper_or_as_a_list():
    assert hn_topics.parse_sort(json.dumps({"1": 1, "2": 3}), 2) == {1: 1, 2: 3}
    assert hn_topics.parse_sort(json.dumps({"sort": [4, 0, True]}), 3) == {1: 4, 2: 0, 3: 0}


def test_sort_ignores_headlines_it_wasnt_given():
    assert hn_topics.parse_sort(json.dumps({"sort": {"1": 1, "2": 1, "40": 3}}), 3) == {1: 1, 2: 1, 3: 0}


def test_sort_answering_too_few_is_asked_again():
    with pytest.raises(ValueError):
        hn_topics.parse_sort(json.dumps({"sort": {"1": 1}}), 20)


# ---- the sort ----

def _fake_chat(sort_answer):
    calls = []

    def chat(system, prompt, model, temperature=0.2, fmt=None):
        calls.append(prompt)
        if "Name the five topics" in prompt:
            return json.dumps(TOPICS)
        return sort_answer(prompt)
    return chat, calls


def test_sort_bins_stories_and_spikes_misfits(monkeypatch, ready):
    monkeypatch.setattr(hackernews, "top_items", lambda n: _stories(100))
    # headline i of a batch goes to topic i % 6 (0 = the spike)
    chat, calls = _fake_chat(lambda p: json.dumps({"sort": {str(i): i % 6 for i in range(1, 21)}}))
    monkeypatch.setattr(llm, "chat", chat)
    steps = []
    out = hn_topics.sort(progress=lambda **kw: steps.append(kw))
    assert len(calls) == 6  # one naming call + five batches of twenty
    assert [t["name"] for t in out["topics"]] == [t["name"] for t in TOPICS["topics"]]
    sizes = [len(t["items"]) for t in out["topics"]]
    assert sum(sizes) + len(out["spiked"]) == 100 and out["jammed"] == 0
    assert out["topics"][0]["items"][0]["id"] == "hn:1"           # in front-page order
    assert out["spiked"][0] == {"id": "hn:6", "title": "Story 6", "rank": 6}
    assert [s.get("done") for s in steps if "done" in s] == [20, 40, 60, 80, 100]
    assert steps[0]["stage"] == "naming" and len(steps[0]["partial"]["tape"]) == 100


def test_a_batch_that_fails_twice_is_spiked_as_jammed(monkeypatch, ready):
    monkeypatch.setattr(hackernews, "top_items", lambda n: _stories(40))

    def answer(prompt):
        if "[1] Story 21" in prompt:  # the second batch
            return "not json"
        return json.dumps({"sort": {str(i): 1 for i in range(1, 21)}})
    chat, calls = _fake_chat(answer)
    monkeypatch.setattr(llm, "chat", chat)
    out = hn_topics.sort()
    assert len(calls) == 1 + 1 + 2  # the bad batch asked twice
    assert out["jammed"] == 20 and len(out["topics"][0]["items"]) == 20
    assert all(s["jammed"] for s in out["spiked"])


def test_no_five_topics_jams_the_sort(monkeypatch, ready):
    monkeypatch.setattr(hackernews, "top_items", lambda n: _stories(20))
    monkeypatch.setattr(llm, "chat", lambda *a, **k: json.dumps({"topics": ["Tech"]}))
    with pytest.raises(hn_topics.Jammed, match="five clear topics"):
        hn_topics.sort()


def test_not_ready_says_why(monkeypatch):
    monkeypatch.setattr(llm, "chat_model", lambda: "llama3.1:8b")
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "has_model", lambda m: False)
    model, problem = hn_topics.readiness()
    assert model == "llama3.1:8b" and "ollama pull llama3.1:8b" in problem
    monkeypatch.setattr(llm, "available", lambda: False)
    assert "Ollama isn't running" in hn_topics.readiness()[1]


# ---- the API ----

def test_reading_never_starts_a_sort(client, monkeypatch, ready):
    started = []
    monkeypatch.setattr(hn_topics, "start", lambda: started.append(1))
    d = client.get("/api/hackernews/topics").get_json()["data"]
    assert d["ready"] and d["result"] is None and d["stale"] and not started


def test_sort_endpoint_refuses_when_the_ai_is_out(client, monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: False)
    r = client.post("/api/hackernews/topics/sort")
    assert r.status_code == 503 and "Ollama" in r.get_json()["error"]


def test_a_finished_sort_is_read_back(client, monkeypatch, ready):
    monkeypatch.setattr(hackernews, "top_items", lambda n: _stories(20))
    chat, _ = _fake_chat(lambda p: json.dumps({"sort": {str(i): 2 for i in range(1, 21)}}))
    monkeypatch.setattr(llm, "chat", chat)
    hn_topics._run()  # what start() runs on its thread
    d = client.get("/api/hackernews/topics").get_json()["data"]
    assert d["status"] == "idle" and not d["stale"]
    assert len(d["result"]["topics"][1]["items"]) == 20


def test_only_one_sort_at_a_time(monkeypatch, ready):
    monkeypatch.setitem(hn_topics._state, "status", "sorting")
    assert hn_topics.start() is False
