# The Edition — implementation plan

> **No 00 — The Edition.** An AI-edited daily paper synthesized from everything the
> station receives: the same story clustered across YouTube, Reddit, and Hacker News,
> written up as one grounded broadsheet — compiled entirely on this machine.

Two non-negotiables drive every decision below:

1. **Speed** — the reader-facing path must never compute anything. Opening The
   Edition is one indexed SQLite row read of a pre-built JSON payload. All
   embedding, clustering, and synthesis happens in a background thread, off the
   request path, always.
2. **Comfort** — the room must feel like the rest of the Shōwa Set: warm, ruled,
   soft-cornered, token-driven so every skin (including `terminal`) gets it for
   free. Details are specified per-element below; nothing is left to improvisation.

---

## 0. Architecture at a glance

```
feeds fetched (existing) ──▶ feed_index: embed new items (1 batched Ollama call)
                                   │  feed_vectors table (unit float32 blobs)
edition builder thread ──▶ cluster (URL hard-links + one cosine matmul)
   (daemon, like notifier)      │
                            salience rank ──▶ slots (lede / columns / briefs)
                                   │
                            synthesize top ≤6 clusters (grounded, JSON-mode,
                            citation-validated, template fallback)
                                   │
                            ONE prebuilt JSON payload ──▶ editions table
                                                              │
GET /api/edition/latest ◀──────────────────────── SELECT 1 row (sub-ms)
```

Degradation ladder (each level fully usable):

| Available | Result |
|---|---|
| nothing (no numpy, no Ollama) | **Wire Edition** — URL hard-link clustering only, heuristic ranking, template headlines |
| numpy + embed model | semantic clustering, template stories |
| + chat model | full synthesized edition (status `edited`) |

---

## 1. Data model (`server/db.py`)

Append to `SCHEMA` (idempotent, matches existing style):

```sql
-- The Edition: embedded feed items + pre-built daily papers.
CREATE TABLE IF NOT EXISTS feed_vectors (
  item_id      TEXT PRIMARY KEY,      -- e.g. 'yt:abc', 'hn:41231', 'rd:t3_x'
  platform     TEXT NOT NULL,
  title        TEXT,
  snippet      TEXT,                  -- selftext/description, pre-truncated
  url          TEXT,                  -- canonical (see §3.1)
  source_id    TEXT,
  source_name  TEXT,
  thumbnail    TEXT,
  score        INTEGER,
  comments     INTEGER,
  published_at INTEGER,
  vector       BLOB,                  -- UNIT-NORMALIZED packed float32 (see §2)
  model        TEXT,                  -- embed model; mismatch ⇒ re-embed
  embedded_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_vectors_time ON feed_vectors(published_at);

CREATE TABLE IF NOT EXISTS editions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  date     TEXT NOT NULL UNIQUE,      -- 'YYYY-MM-DD' local
  status   TEXT NOT NULL,             -- 'wire' | 'edited'
  model    TEXT,                      -- chat model used (null for wire)
  sources  INTEGER NOT NULL,          -- item count that fed this paper
  build_ms INTEGER NOT NULL,
  payload  TEXT NOT NULL,             -- the complete pre-rendered edition JSON
  built_at INTEGER NOT NULL
);
```

Design notes:

- **One `payload` JSON per edition, no story table.** Same pattern as `saved`.
  The API never joins, never ranks, never touches vectors — the payload *is* the
  page. This is the single most important performance decision in the plan.
- **Vectors are unit-normalized at write time** so cosine similarity is a plain
  dot product — no per-row `np.linalg.norm` like `brain/search.py` pays today.
- `feed_vectors` doubles as tomorrow's foundation for "search everything I've
  ever seen"; nothing here is edition-specific.

New `db.py` functions (follow the `brain_*` naming/section style):

```python
def feed_vectors_missing(item_ids):        # -> subset not yet embedded (1 query, IN batch)
def feed_vectors_save(rows):               # executemany INSERT OR REPLACE
def feed_vectors_recent(since_ts, model):  # rows w/ vector for clustering window
def feed_vectors_recent_meta(since_ts):    # rows w/o vector (wire-mode clustering)
def feed_vectors_prune(max_age=14*86400):  # called from prune_old_data()

def edition_save(date, status, model, sources, build_ms, payload):  # upsert on date
def edition_latest():                      # -> {meta..., payload} | None  (1 row)
def edition_get(date):
def edition_list(limit=60):                # meta only — NEVER selects payload
def edition_prune(keep=90):
```

`edition_list` selecting meta-only matters: payloads are ~30–60 KB each; the
archive drawer must not drag 90 of them across a query.

---

## 2. Feed indexer (`server/brain/feed_index.py`, ~90 lines)

**Hook point:** the edition builder pulls from the *existing SQLite cache* —
`cached()`/`cached_swr()` already persist every feed payload the user's rooms
fetch. No changes to `sources/` or `api/feeds.py`; the indexer is a pure consumer.
(This also means the paper is built from *your* orbit — subscribed channels,
subs, HN front — not from anything fetched specially for it.)

```python
def collect_items():
    """Harvest normalized items from cache rows (yt:*, reddit:*, hn:*) newer
    than the window; dedupe by item_id; truncate snippets to 400 chars."""

def index_new(items, model):
    """items not in feed_vectors (or embedded with a different model) →
    ONE llm.embed() batch → normalize → pack → feed_vectors_save()."""
```

Performance contract:

- **One `/api/embed` call per build** for all new items (the batched path in
  `llm.embed` already exists). A day of feeds is ~100–400 short strings —
  single-digit seconds on any machine that runs Ollama at all.
- Embed input is `f"search_document: {title}\n{snippet}"` (nomic's document
  prefix; store plain title/snippet in the row, prefix only at embed time).
- Normalize with one vectorized op: `vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)`.
- `model` column checked so switching embed models triggers re-embed instead of
  silently mixing vector spaces.

---

## 3. Clusterer (`server/brain/cluster.py`, ~150 lines, **pure functions — no I/O**)

Keeping this module I/O-free makes it the most testable code in the repo.

### 3.1 Canonical URLs — the hard-link pass (runs even with zero ML)

```python
def canonical_url(url):  # and canonical_key(item)
```

- lowercase host, strip `www.`, strip `utm_*`/`ref`/`si`/`t` params, drop fragment
- `youtu.be/X`, `youtube.com/watch?v=X`, `yt:X` item ids → key `yt:X`
- Reddit link-posts use the *outbound* URL as key; HN uses its `url` field
- Items sharing a canonical key are **force-merged** before any vector math.
  This is what makes "the same launch on HN + r/programming + a YouTube video"
  collapse reliably rather than probabilistically.

### 3.2 Semantic pass — one matmul, not a loop

```python
def cluster(items, vectors, threshold):   # vectors: (n, d) unit matrix or None
```

- Greedy agglomerative, newest-first. Candidate assignment for each item is
  `centroids @ v` — a single `(k, d) @ (d,)` product; centroids kept unit-length
  via incremental update + renormalize. Total work is O(n·k) with k ≈ 30–60:
  microseconds at this scale. **No FAISS, no sklearn, no new dependency** —
  same philosophy as `brain/search.py`, but vectorized instead of per-row Python.
- `threshold` from config (start 0.62 for nomic; it's a setting, see §7).
- `vectors=None` (wire mode) ⇒ hard-link pass only; singletons remain singletons.

### 3.3 Salience — what makes it an editor

```python
def salience(cluster, subs_ids, history_source_ids, now):
```

`(1 + 0.8·(platforms−1))` — **cross-platform diversity dominates**, a 3-platform
story beats a big single-platform one — `× log1p(Σscore)` engagement, `×
exp(−age_hours/18)` recency decay, `× (1.25 if any source in your subs/watch
history)` affinity. All tunable constants live at the top of the module with a
comment each.

### 3.4 Slots

```python
def layout(clusters):  # -> {"lede": c, "columns": [≤5], "briefs": [≤14]}
```

Lede = top salience **with a thumbnail** (mirrors FrontPage's lede pick);
columns = next 5; briefs = next 14, single line each. Everything else is
dropped — an editor's job is also what to leave out.

---

## 4. Synthesizer (`server/brain/edition.py`, ~220 lines)

### 4.1 Grounded synthesis with a validation gate

For lede + columns only (**≤ 6 LLM calls per build, hard cap**):

- Prompt = cluster items as a compact numbered list (`[1] (youtube · MKBHD ·
  2h ago) Title — snippet…`), snippets pre-truncated to 400 chars, ≤ 6 items
  per cluster ⇒ prompt stays well under a 4k context, no `num_ctx` games.
- `llm.chat()` gains one optional kwarg: `format="json"` passed through to
  Ollama (3-line change, backwards-compatible). Temperature 0.15.
- System prompt: *newsroom copy desk; use ONLY the provided items; every claim
  must be attributable; return `{"headline", "dek", "body", "cited"}`; headline
  ≤ 12 words, dek one sentence, body ≤ 120 words, `cited` = item numbers used.*
- **Validation gate:** parse JSON → check all fields present, `cited ⊆
  provided numbers`, body word count within bounds, headline not a verbatim
  copy of a single item title with nothing else in `cited`. One retry on
  failure, then **template fallback** — never a hallucinated story, never a
  blocked build.

```python
def _template_story(cluster):   # headline = top item title, dek = "As seen in
                                # N places", body = stitched snippets. Also the
                                # entire story generator for wire editions.
```

### 4.2 Build

```python
def build(force=False):
    t0 = monotonic()
    items   = feed_index.collect_items()                  # cache tables only
    ok_ml   = _numpy_ok() and llm.available() and llm.has_model(embed_model)
    if ok_ml: feed_index.index_new(items, embed_model)    # 1 batched call
    clusters = cluster.cluster(...)                        # §3
    slots    = cluster.layout(...)
    stories  = _synthesize(slots) if chat_ok else _templates(slots)
    payload  = {"date", "status", "model", "generated_at", "build_ms",
                "sources", "lede", "columns", "briefs"}    # ready-to-render
    db.edition_save(...)
    cache.invalidate("edition:")
```

Payload stories carry everything the UI needs — `headline, dek, body, cited,
salience, items:[{id, platform, title, url, source, score, comments,
published_at, thumbnail}]` — so the frontend does **zero** joins, lookups, or
derived computation. Render-ready is the contract.

### 4.3 Builder thread (daemon, exactly the `notifier.py` shape)

```python
POLL_SECONDS = 600          # 10 min heartbeat
def _loop():
    time.sleep(45)          # after notifier(30) — don't pile onto startup
    while True:
        try:
            if db.get_setting("edition_enabled", True) and _should_build():
                build()
        except Exception:
            pass
        time.sleep(POLL_SECONDS)
```

`_should_build()`: no edition for today AND local hour ≥ `edition_hour`
(default 6). One paper a day, like a paper; ⟳ / `POST /rebuild` for the rest.
Manual rebuilds run on a one-shot thread so the API returns immediately
(`202`-style `{"building": true}`), with a `threading.Lock` guaranteeing one
build at a time. Registered in `main.py` as `edition.start()` next to
`brain.start()` — and `start()` is unconditional (wire mode needs no wheels),
unlike the whisper-gated brain worker.

---

## 5. API (`server/api/edition.py`, ~70 lines)

Blueprint `edition_bp`, `url_prefix="/api"`, registered in `api/__init__.py`.
Everything through `ok()`/`err()`.

| Route | Behavior | Budget |
|---|---|---|
| `GET /api/edition/latest` | `db.edition_latest()` → parsed payload. `404`-shaped `err("no edition yet", 404)` before first build. | **< 5 ms** — one PK-adjacent row, `json.loads`, out |
| `GET /api/edition/<date>` | `db.edition_get(date)` | same |
| `GET /api/edition/archive` | `edition_list()` — meta only | < 5 ms |
| `POST /api/edition/rebuild` | spawn build thread, return `{"building": true}` immediately | < 5 ms |
| `GET /api/edition/status` | `{building, last_built_at, status}` — the UI polls this (3 s interval) only while a rebuild is in flight | trivial |

No streaming, no pagination, no query params on the hot path. The whole paper
is one ~30–60 KB gzip-friendly response.

---

## 6. Frontend — the room (`pages/Edition.jsx` + `edition.module.css`)

### 6.1 Wiring

- Route `/edition` in `App.jsx` (eager import like every other page — the
  component is small; consistency beats a lazy-load spinner here).
- Masthead nav entry + CommandPalette entry + a key in `KeyboardShortcuts`,
  following however each currently registers rooms.
- Data: single `useApi('/edition/latest')`. No providers touched; opening a
  story reuses the exact existing surfaces — `usePlayer().open` for YouTube,
  `RedditPostModal`, `HNCommentsPanel` — the same trio FrontPage already wires.

### 6.2 Performance details (this is the "quick loading" contract)

- **Zero new npm dependencies.** Fonts, icons, router — all already there.
- One fetch, already-ranked data, purely presentational render: no `useEffect`
  chains, no client-side sorting, no memo gymnastics needed.
- **Zero layout shift:** every image slot declares `aspect-ratio` (lede
  `16/10`, matching `.ledeImage`); the skeleton mirrors the real grid
  dimensions exactly, so paint → content is a cross-fade, not a reflow.
- Lede image: `fetchpriority="high"`, `decoding="async"`. Everything below the
  fold: `loading="lazy"`. Briefs have no images at all — text renders instantly.
- Animations are the existing `fadeUp` keyframe, staggered via
  `animation-delay: calc(var(--i) * 40ms)` with `--i` set inline — CSS-only,
  compositor-friendly (opacity/transform), and wrapped in
  `@media (prefers-reduced-motion: reduce) { animation: none }`.
- Archive drawer fetches `/edition/archive` **only when opened**.

### 6.3 Design spec — Shōwa Set, attention to detail

Token-only styling (`var(--paper)`, `--rule`, `--signal`, `--font-display`…):
every skin, including `terminal` and `light`, inherits the room for free.
Verify under all three before calling it done.

**Nameplate (top of page):**
- `SectionHead` kicker: `No 00 — The Edition`, note: *"One paper from every
  room of the station, set and printed on this machine."*, color `--c-foryou`.
- Below it, a **dateline rule**: `3px double var(--rule-strong)` top border
  (the broadsheet signature from `.lede`), then a mono line, letter-spacing
  `0.18em`, `--paper-faint`:
  `VOL. I · No 27 — WEDNESDAY, 2 JULY 2026 — COMPILED LOCALLY · LLAMA3.1:8B · 43 SOURCES · 12.4s`
  Numerals get `font-variant-numeric: tabular-nums` so archive paging doesn't
  jiggle. A wire edition swaps the model segment for `WIRE EDITION — PRESSES
  COLD` in `--signal`.

**Lede story:**
- Two-column grid `1.4fr 1fr` (mirror `.lede`), headline in Fraunces at
  `clamp(34px, 5vw, 58px)`, `font-variation-settings: 'opsz' 144, 'SOFT' 20`,
  `line-height 1.04`, `text-wrap: balance`.
- Dek: 17px Fraunces italic, `--paper-dim`, max-width `52ch`.
- Body: 15px, `line-height 1.65`, `max-width 58ch`, with a **drop cap** —
  `::first-letter` in Fraunces, `float: left`, sized to exactly 2 body lines,
  `--signal`, `padding-right: var(--space-2)`. Suppressed for wire editions
  (stitched snippets don't deserve a drop cap) via a `.wire` modifier class.
- Body ends with an **end mark**: `" ◼"` at 0.55em in `--signal` — the
  traditional tombstone, tiny, the kind of detail nobody notices consciously.

**Source chips (on every story):**
- Pill row under the body: `--r-pill`, 1px `--rule` border, mono 11px. Each
  chip = platform glyph + source + stat, colored with its platform token:
  `▶ MKBHD 1.2M views` (`--c-youtube`) · `⬢ HN 341▲ · 220 cmt` (`--c-hn`) ·
  `◆ r/technology 2.1k▲` (`--c-reddit`).
- Hover: background `color-mix(in srgb, var(--chip-c) 12%, transparent)`,
  120ms ease. Click opens the item's native surface (player/modal/panel).
  Chips are `<button>`s with real focus rings (`outline: 2px solid
  var(--signal); outline-offset: 2px`) — full keyboard traversal.
- A `+2 more` overflow chip expands in place; never a tooltip-only affordance.

**Columns (the 5 second-rank stories):**
- CSS grid, `repeat(auto-fit, minmax(300px, 1fr))`, separated by **real column
  rules**: `border-left: 1px solid var(--rule)` + `padding-left:
  var(--space-5)` on every column after the first (`:not(:first-child)`), the
  way a broadsheet actually rules columns.
- Headline 22px Fraunces (`'opsz' 60`), dek 13.5px `--paper-dim` clamped to 2
  lines, chips compact (glyph + count only). Headline tints to the cluster's
  dominant platform color on hover — same move as `.lede:hover .ledeTitle`.

**In Brief (the rail):**
- Section slug `IN BRIEF` in mono under a single `--rule` line, then CSS
  multi-column (`columns: 3; column-rule: 1px solid var(--rule); column-gap:
  var(--space-6)`; 2 → 1 columns at breakpoints).
- Each brief one line: `▸ headline — source · 2h`, `break-inside: avoid`,
  13.5px, baseline-aligned. Hover underlines with `text-decoration-color:
  var(--signal)` and `text-underline-offset: 3px`.

**Bottom colophon:**
- Centered mono, `--paper-faint`, boxed by hairline rules above and below:
  `— Set in Fraunces & Schibsted Grotesk · composed by llama3.1:8b · nothing
  left this machine —`
  Flanked by `← YESTERDAY'S PAPER` / `TOMORROW →` (disabled styling with
  `cursor: default` + 40% opacity when at either end), navigating
  `/edition/<date>` via the archive list. The paper reads like an object with
  a front and a back, not an infinite feed.

**States, all designed (no unstyled flashes):**
- *First run / presses warming:* a `.glass` card, centered — mono slug
  `THE PRESSES ARE WARMING`, one Fraunces line "Your first edition is being
  composed from today's signals.", a soft `--signal` pulse dot (2s ease
  opacity keyframe, reduced-motion-safe). Auto-refreshes via the status poll.
- *Rebuilding (paper exists):* current paper stays fully readable; only a
  small pulsing `RECOMPOSING…` slug appears at the dateline's right edge. The
  new paper **cross-fades in** (150ms opacity) when the poll flips — content
  is never yanked mid-read.
- *Error:* existing `ErrorBox`.
- *Skeleton:* dimension-identical shimmer blocks for nameplate/lede/columns
  (`--surface` base, `--surface-hover` shimmer) — shown only when there's no
  cached data at all.

---

## 7. Config & settings

`server/config.py` (with the customary comment each):

```python
TTL_EDITION_STATUS = 3            # status poll is cheap but no need to hammer
EDITION_WINDOW_H   = 36           # clustering lookback
EDITION_SIM        = 0.62         # cosine threshold (nomic-embed-text)
EDITION_MAX_SYNTH  = 6            # hard cap on LLM calls per build
EDITION_SNIPPET    = 400          # chars of snippet fed to embed/synth
```

`DEFAULT_SETTINGS` in `db.py`:

```python
"edition_enabled": True,
"edition_hour": 6,          # local hour after which today's paper is composed
"edition_llm_model": "",    # blank → falls back to brain_llm_model
```

Settings page: an "Edition" group in `SettingsPage.jsx` — enable toggle,
hour picker, model override, and a "Recompose now" button wired to `/rebuild`.

---

## 8. Tests (`tests/test_edition.py`, using the existing `client` fixture)

The pure-function core means most coverage needs no mocks and no numpy:

- `canonical_url`: youtu.be collapse, utm stripping, reddit-outbound, HN url,
  fragment/trailing-slash handling.
- Hard-link merge: yt video + reddit link-post + HN story with the same target
  → one cluster (no vectors involved).
- `salience`: 3-platform cluster outranks larger single-platform; recency
  decay ordering; affinity boost applies.
- `layout`: lede requires a thumbnail; slot caps respected.
- Vector clustering under `pytest.importorskip("numpy")` with tiny handmade
  unit vectors: above/below threshold behavior, centroid drift.
- Synthesis **validator** (not the LLM): valid JSON passes; missing field,
  out-of-range citation, and over-long body each reject → template fallback.
- API: `latest` 404-shape before first build; roundtrip after a stubbed
  `edition_save`; archive returns meta without payloads; rebuild returns
  immediately.

---

## 9. Build order (each step ships something)

| # | Step | Deliverable |
|---|---|---|
| 1 | Schema + `db.py` functions + prune hooks | invisible foundation |
| 2 | `cluster.py` (canonical URLs, clustering, salience, layout) **with its full test file** | the algorithmic core, proven before any I/O exists |
| 3 | `feed_index.py` + wire-mode `edition.py` build + builder thread + API | **Wire Edition works end-to-end with zero ML installed** |
| 4 | `Edition.jsx` + full Shōwa Set styling + all four states + Masthead/palette/keys | the room, comfy, on every skin |
| 5 | Synthesis + validation gate + `format="json"` in `llm.chat` | the edited paper |
| 6 | Settings group, archive drawer + yesterday/tomorrow nav, README room table row (No 00) + CLAUDE.md notes | polish & docs |

Steps 3→4 can swap if you'd rather see the room first against a hand-written
fixture payload.

---

## 10. Performance budget (the numbers this plan commits to)

| Path | Budget | Why it holds |
|---|---|---|
| `GET /edition/latest` | < 5 ms server | one indexed row + `json.loads`, no joins, no vectors |
| Payload size | 30–60 KB | text + thumb URLs only; briefs carry no images |
| Route time-to-content | one RTT after shell | single fetch, render-ready data, zero client computation |
| Layout shift | CLS ≈ 0 | aspect-ratio reserved everywhere; skeleton is dimension-identical |
| Build: embeddings | 1 Ollama call | batched `/api/embed`, only *new* items |
| Build: clustering | < 50 ms | unit vectors at write time ⇒ cosine = dot; one matmul per item over ≤ ~60 centroids |
| Build: LLM | ≤ 6 calls, ≤ 1 retry each | hard cap; briefs are always template |
| Request-path vector math | **none, ever** | the payload is the page |
