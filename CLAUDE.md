# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tubcal is a single-user, localhost-only media hub: one Flask backend (bound to
`127.0.0.1`) that aggregates YouTube, Reddit, Hacker News, and anime (AniList)
into a React SPA, plus an optional fully-local AI "second brain" (The Archive)
over watched videos. There is no multi-user concept, no auth beyond optional
per-provider OAuth, and no cloud component — the only outbound traffic is direct
fetches to the platforms themselves.

## Commands

```bash
# one-time / after dependency changes
uv sync                                   # backend deps (Python >= 3.12)
uv sync --extra brain                     # + The Archive (faster-whisper, numpy)
cd frontend && npm install                # frontend deps

# run — single-port production mode (Flask serves frontend/dist)
cd frontend && npm run build && cd ..
uv run python main.py                     # http://127.0.0.1:5000

# run — dev mode (two servers, /api proxied 5173 -> 5000)
uv run python main.py                     # backend on :5000
cd frontend && npm run dev                # UI on :5173

# tests
uv run pytest                             # all backend tests
uv run pytest tests/test_api.py::test_name -q   # a single test
```

There is no linter/formatter configured, and no frontend tests. After a UI change
in production mode you must `npm run build` and hard-refresh; backend changes need
a server restart.

## Architecture

**Request flow:** React (`frontend/src/api/client.js` → `api()`/`useApi()`) →
Flask blueprints in `server/api/*` → source adapters in `server/sources/*` →
`server/httpc.py` (shared `requests.Session`) → external platform. Every API
response is wrapped `{ok, data}` / `{ok, error}` by `server/api/__init__.py`'s
`ok()`/`err()` helpers, and the client unwraps `data` or throws on `ok === false`.
`/api/*` responses are forced `Cache-Control: no-store`; everything else is the SPA.

**Entrypoint (`main.py`):** `db.init_db()` → `create_app()` → warm the "picked for
you" cache and backfill channel avatars in background threads → start the notifier
and brain workers → `app.run()`. Background warming exists so slow shelves are ready
before first request.

**Caching (`server/cache.py`) is central.** Two layers (in-memory dict + a `cache`
table in SQLite) so caches survive restarts. Key functions: `cached(key, ttl,
fetcher)`, `cached_swr(...)` (stale-while-revalidate), `warm(...)`, `invalidate(prefix)`.
Expired rows are kept deliberately: if an upstream fetch fails, the stale payload is
served instead of erroring — this is what keeps Reddit's aggressive rate limiting from
breaking the app. TTLs live in `server/config.py`. When adding a source call, wrap it
in the cache with an appropriate TTL rather than fetching raw.

**Rate limiting:** `server/httpc.py` enforces per-host minimum spacing via
`config.HOST_INTERVALS` (Reddit is throttled to one request / 3s). It also runs a
deliberately large connection pool because proxying an HLS rendition fans out into
many concurrent segment fetches to one googlevideo host.

**State & persistence:** everything lives in one SQLite file `data/tubcal.db`
(git-ignored) via `server/db.py` — subscriptions, settings (key/value), watch
history + playback progress, saved items, OAuth credentials/tokens, and all Archive
data (transcripts, chunk vectors as float32 blobs, queue/status). `data/` also holds
`.bak-*` DB snapshots. All DB access goes through the functions in `db.py`; there is
no ORM.

**Sources (`server/sources/`)** each own one platform's quirks:
- `youtube.py` — RSS for subscriptions (no API key needed), `invidious.py` for
  trending/search, `yt-dlp` (must be on PATH) for stream resolution and captions.
  `get_discover()` builds "The Projection" recommendation shelf from watch history.
- `reddit.py` — anonymous access is RSS-only (Reddit blocks anonymous JSON), so
  logged-out data is degraded; OAuth upgrades it. Threaded comments.
- `hackernews.py` — Firebase API + Algolia search.
- `anilist.py` — GraphQL; reads cached, user writes (progress sync) uncached.
  AniList now 403s *unauthenticated* reads, so `_post` falls back to the connected
  account's OAuth token when a caller passes none.
- `anime_source.py` — resolves the episode list + playable streams with `anipy_api`
  (the allanime/animekai scraper Shou uses); no external aggregator needed. It maps
  the AniList id to a title via `anilist.media`, searches the provider, and returns
  the same `{sources,subtitles,headers}` shape the player/proxy forward. The old
  `TUBCAL_ANIME_SOURCE` / `anime_source_url` setting is now inert.
- `mixer.py` — deterministic weighted round-robin that interleaves platforms into
  the Front Page "For You" feed.

**The Edition (`server/brain/{cluster,feed_index,edition}.py` + `server/api/edition.py`)**
is the daily synthesized paper (room "No 00", route `/edition`). Architecture rule:
the request path computes nothing — a background thread (started in `main.py` via
`brain.edition.start()`) builds one JSON payload per day into the `editions` table,
and `GET /api/edition/latest` is a single row read. `cluster.py` is pure functions
(canonical-URL hard-linking, greedy centroid clustering over unit vectors so cosine
= dot, salience, layout) — extend it there and keep it I/O-free; it has the deepest
test coverage (`tests/test_edition.py`). LLM synthesis is capped (≤6 calls/build),
time-boxed, and gated by `_validate_synthesis` with a template fallback — never let
unvalidated model output into a payload. Degrades: no numpy/Ollama → "wire" edition
(URL hard-links only) → embed model adds semantic clusters → chat model adds prose.

**The Archive (`server/brain/`)** is optional and fully local. A background `worker`
transcribes watched videos with faster-whisper (`transcribe.py`), chunks + embeds
transcripts into SQLite (`search.py` does brute-force cosine over `brain_all_vectors()`),
and answers via a local Ollama server over plain HTTP (`llm.py`, no client lib). It has
knowledge memory (the transcript corpus), not conversational memory — each answer is
fresh. Requires the `brain` extra and a running Ollama server; degrades gracefully when
absent.

**Frontend (`frontend/src/`):** React 19 + Vite, React Router. `state.jsx` holds all
shared state as a stack of context providers (`useSettings`, `useSubscriptions`,
`usePlayer`, `useProgress`, `useSaved`, `useAnimeSync`) wrapped by `AppProviders`.
One page component per "room" in `pages/` (FrontPage, ScreeningRoom, Dispatch, Wire,
Archive, Anime), CSS Modules per page/component, design tokens in `styles/tokens.css`
and `styles/themes.css`. Two themes (`dark`/`light`); the saved theme is injected
server-side into `index.html` on first paint. The video player (`components/player/`)
uses `hls.js`. Full keyboard nav + command palette in `components/layout/`.

## Conventions

- Backend API endpoints return `ok(data)` / `err(msg, status)` — never bare `jsonify`.
- New external fetches go through `server/httpc.py` and are wrapped in `server/cache.py`
  with a TTL constant added to `server/config.py`.
- Configuration is env-driven through `server/config.py` (all optional, `.env` copied
  from `.env.example`); user-facing settings that can change at runtime are stored in the
  DB `settings` table and read via `db.get_setting()`.
- Tests point the app at a throwaway DB via the `client` fixture in `tests/conftest.py`
  (monkeypatches `config.DB_PATH`); tests never touch `data/tubcal.db`.
