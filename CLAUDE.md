# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tubcal is a single-user, localhost-only media hub: one Flask backend (bound to
`127.0.0.1`) that aggregates YouTube, Reddit, Hacker News, GitHub, and anime
(AniList) into a React SPA, plus an optional fully-local AI "second brain" (The
Archive) over watched videos and a code-editor room (The Composing Room). There
is no multi-user concept, no auth beyond optional per-provider OAuth, and no
cloud component — the only outbound traffic is direct fetches to the platforms
themselves.

Every feature is a numbered "room". `frontend/src/lib/rooms.js` is the canonical
registry (id, label, color token, route, `default_enabled`) — the numbers users
see are computed from list position, not hardcoded, so adding a room means adding
an entry there plus a page in `pages/`. Rooms are reorderable and toggleable in
Settings → Rooms; GitHub is the one that ships off by default.

## Commands

```bash
# one-time / after dependency changes
uv sync                                   # backend deps (Python >= 3.12)
uv sync --extra brain                     # + The Archive (faster-whisper, numpy)
uv sync --extra editor                    # + Composing Room terminal/LSP (flask-sock)
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

**Entrypoint (`main.py`):** `updater.check_and_update()` → `db.init_db()` →
`create_app()` → warm the "picked for you" cache and backfill channel avatars in
background threads → start the notifier and brain/edition workers → `app.run()`.
Background warming exists so slow shelves are ready before first request.
`server/updater.py` upgrades `anipy-api` in place from PyPI on startup (allanime
rotates its site crypto and the fix ships as a release); it must run *before*
anything imports anipy, is best-effort/offline-safe, and honors
`TUBCAL_AUTO_UPDATE=0`. `server/notifier.py` polls upcoming subscribed streams and
fires a `notify-send` desktop ping ~10 min before one goes live (no-op if
`notify-send` is absent).

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
  Quality ladder: YouTube's default player clients now expose at most one muxed
  rendition (progressive itag 18 / 360p) — every higher resolution ships only as
  *adaptive* DASH (separate avc1 video-only + AAC audio). So `_collect_streams`
  keeps 360p as an instant floor and, for each avc1 height above it, emits an
  `adaptive` HLS entry pointing at a *synthesized* master playlist. `server/sources/fmp4.py`
  parses each rendition's `sidx` into byte-range segments and `server/api/feeds.py`
  serves a master (one video variant + the original audio as an alternate group)
  plus per-track `#EXT-X-BYTERANGE` media playlists; hls.js muxes video+audio in
  the browser, fetching straight from googlevideo through the existing segment
  proxy — no ffmpeg, no account, no third party, native seeking. `_pick_audio`
  keeps only the creator's original track (dubs/DRC dropped). A resolve that
  yields only the 360p floor is cached briefly (self-heals on the next open).
  Live broadcasts have no DASH, so they stay on YouTube's own muxed HLS.
- `reddit.py` — anonymous access is RSS-only (Reddit blocks anonymous JSON), so
  logged-out data is degraded; OAuth upgrades it. Threaded comments.
- `hackernews.py` — Firebase API + Algolia search. It is the reference pattern for
  a source adapter: `normalize(item)` / `get_feed()` / `search()` / `get_item()`,
  each wrapped in `cache.cached()`.
- `github.py` — public REST API (repos, releases, activity), following the
  hackernews shape. Unauthenticated GitHub allows only 60 req/hr/IP, so cache
  hard; a classic PAT in the `github_token` setting (or `TUBCAL_GITHUB_TOKEN`)
  raises it to 5000. There is no OAuth flow for GitHub — the token is pasted in.
- `anilist.py` — GraphQL; reads cached, user writes (progress sync) uncached.
  AniList now 403s *unauthenticated* reads, so `_post` falls back to the connected
  account's OAuth token when a caller passes none. `media()` carries the cast
  (characters + every dub's voice actors, so the client owns the language switch);
  `staff()` backs the voice-actor dossier at `/anime/voice/:id`. Names come from
  `userPreferred`, which honours the account's own name-order setting — it can read
  "Luffy D. Monkey", and there is no fixing it here, since AniList stores the given
  name in `first` for Japanese and Western characters alike. The native name is
  rendered alongside because it carries the true order. `discover()` filters the
  browse wall by any mix of genres + tags (AniList ANDs `genre_in`/`tag_in`), a sort
  dial and an optional text query, forcing `isAdult:false`; `genre_collection()`
  serves the picker's genre roster + tag vocabulary (grouped by category, adult tags
  dropped, cached a day). Both back the Browse tab's genre/tag finder — and the
  detail page's genre/tag chips deep-link into it via `?tab=browse&g=`/`&t=`.
  `search`/`browse`/`discover` are paginated: each returns `{items, has_next}` (from
  AniList `pageInfo.hasNextPage`) so the Browse wall can infinite-scroll, and each
  caches via `cache.cached_dynamic` with a short `TTL_ANILIST_EMPTY` on an *empty*
  page so a transient rate-limit can't strand a shelf blank for the full window.
- `anime_source.py` — resolves the episode list + playable streams with `anipy_api`
  (the allanime/animekai scraper Shou uses); no external aggregator needed. It maps
  the AniList id to a title via `anilist.media`, searches the provider, and returns
  the same `{sources,subtitles,headers}` shape the player/proxy forward. The old
  `TUBCAL_ANIME_SOURCE` / `anime_source_url` setting is now inert.
  Auto-watched: the anime player reports progress under item ids
  `anime:<anilist_id>:<episode>`, so `feeds.post_progress` piggybacks on those
  POSTs and, once past `ANIME_WATCHED_PERCENT` (default 90), advances AniList
  progress via `anilist.mark_episode_watched` (advance-only, in a background
  thread, once per episode per run) — no extra client call.
- `weeb_fallback.py` — second anime scraper (weeb-cli's `aniworld` provider,
  EngSub/EngDub HLS). `anime_source.watch()` falls back to it when anipy/allanime
  can't resolve, and it returns the identical `{sources,subtitles,headers}` shape
  so nothing downstream special-cases it. Two independent sites rarely break the
  same day — that redundancy is the whole point. Imports are lazy and guarded; the
  provider class is instantiated directly rather than via weeb-cli's registry,
  whose `pkgutil` discovery finds nothing under Chaquopy on the Android build.
- `dev.py` — The Workbench (No 09, route `/dev`): one programming language per
  "service manual". `LANGUAGES` is a pure-curation registry (facts, docs, podcast
  RSS dials, core-team blog feeds, GitHub repo, per-language accent) — adding a
  language is adding one dict, no new endpoints or UI. Shelves are one endpoint
  each under `/api/dev/<lang>/…` (videos via `invidious.search`, podcasts + blog
  updates via a namespace-agnostic RSS/Atom parser (`parse_feed`), trending repos
  via `github.trending(language=…)`), so each loads and fails independently. The
  "current stable" stamp is best-effort: GitHub `releases/latest`, falling back to
  a per-language `tag_re` over `/tags` (CPython finals only) or Go's own
  `go.dev/dl/?mode=json` — golang/go's tag listing is lexicographic garbage.
  Podcast episodes play in the page's own "bench radio" `<audio>`; videos open in
  the normal in-app player since Invidious items are already yt-shaped. Tests:
  `tests/test_dev.py` (network edge monkeypatched).
- `fuzzy.py` — rapidfuzz scoring over recently cached feed items, used as a
  fallback when a platform's own search returns little or nothing, so a near-miss
  query still lands without another API hit.
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

**The Composing Room (`server/api/editor.py` + `server/editor/` + `frontend/src/components/editor/`)**
is the code editor room (No 08, route `/editor`): CodeMirror 6 with real modal vim
(`@replit/codemirror-vim`), file tree, tabs/splits, go-to-file, project grep (rg with
an os.walk fallback), git gutter/branch, a which-key leader menu, session restore
(`editor_state` table), an integrated PTY terminal, and an optional LSP bridge.
Security rule: every client path goes through `_safe()` in `server/api/editor.py`,
which resolves against `config.EDITOR_ROOT` (env `TUBCAL_EDITOR_ROOT`, default
`~/Projects`) and rejects escapes — traversal, absolute paths, and symlinks out.
Writes are atomic (temp + `os.replace`) with an mtime precondition (409 on conflict;
`:w!` forces). The terminal (`server/editor/terminal.py`) and LSP bridge
(`server/editor/lsp.py`, stdio JSON-RPC ⇄ plain-JSON WebSocket frames) ride on
`flask-sock` (`editor` extra) and degrade to a pure editor when absent; language
servers are probed at launch (`lsp.available()` — `which` alone lies for rustup
shims). The CM theme (`components/editor/cm/theme.js`) uses only `var(--token)`
references so all skins restyle the buffer with zero JS; xterm's ANSI palette is
rebuilt from tokens on `data-theme` mutation. While the room holds focus it sets
`document.body.dataset.editorFocused` so the global vim nav stands down. Tests:
`tests/test_editor.py` (containment is the part to keep green).

**Frontend (`frontend/src/`):** React 19 + Vite, React Router. `state.jsx` holds all
shared state as a stack of context providers (`useSettings`, `useSubscriptions`,
`usePlayer`, `useProgress`, `useSaved`, `useAnimeSync`) wrapped by `AppProviders`.
One page component per "room" in `pages/` (Edition, FrontPage, ScreeningRoom,
Dispatch, Wire, Archive, Anime, Composer, Github, Workbench, plus SavedPage and
SettingsPage),
all lazy-loaded and routed in `App.jsx` — keep the route, the `pages/` component, and
the `lib/rooms.js` entry in sync. CSS Modules per page/component, design tokens in `styles/tokens.css`
and `styles/themes.css`. Skins are a registry in `lib/themes.js` (`dark`, `light`,
`terminal`, `bauhaus`, `blueprint`, `aqua`, `space`) — each is a `[data-theme]`
block overriding tokens, so component CSS restyles for free via `var(--token)`;
the saved theme is injected server-side into `index.html` on first paint. Note
`dark`/`light` are not the only two: `bauhaus` and `aqua` are light-backed as well
(`--ink` is the background), which matters for anything reading `color-scheme`. A room's view state (active tab,
filters, search) belongs in the query string, not `useState` — opening a detail
route unmounts the room, so local state is lost on back. `useParamState` in
`pages/Anime.jsx` is the reference: it writes with `replace` (a filter toggle is
not a destination) and drops default values from the URL. The video player (`components/player/`)
uses `hls.js`. Full keyboard nav + command palette in `components/layout/`.

The three anime routes (`/anime`, `/anime/:id`, `/anime/voice/:id`) are wrapped in a
shared layout route (`AnimeSection` in `App.jsx`) whose only job is to mount one
`AnimeCalcProvider` (`components/anime/WatchCalculator.jsx`) across the whole section
— "The Reckoner", a watch-time calculator docked in the page's side margin. Hovering
any `AnimeCard`/`BrowseCard`/detail dossier arms it (via `useAnimeCalc().hoverProps`,
tracked in a ref so the card wall never re-renders on hover); tapping `C` tallies the
next *unwatched* episode (progress from `list_entry` + the sync overlay, capped at
aired-so-far = `next_episode - 1`), each further `C` extends the run. It sums per-episode
`duration` (AniList's field; falls back to 24 min, flagged "estimated") into a total and
a live "start now, finish at…" wall-clock, and persists the plan to `localStorage`. The
`C` handler stands down for modifiers, text fields, an expanded player/editor, and the
1s window after a `g` (so the `g c` → editor room-jump chord still wins). The dock seats
itself in the margin when it fits (≥ `PANEL_W` of side space past the 1280px shell) and
floats/rails otherwise.

## Conventions

- Backend API endpoints return `ok(data)` / `err(msg, status)` — never bare `jsonify`.
- New external fetches go through `server/httpc.py` and are wrapped in `server/cache.py`
  with a TTL constant added to `server/config.py`.
- Configuration is env-driven through `server/config.py` (all optional, `.env` copied
  from `.env.example`); user-facing settings that can change at runtime are stored in the
  DB `settings` table and read via `db.get_setting()`.
- Tests point the app at a throwaway DB via the `client` fixture in `tests/conftest.py`
  (monkeypatches `config.DB_PATH`); tests never touch `data/tubcal.db`.
- Heavy or native dependencies (anipy, weeb-cli, rapidfuzz, numpy, faster-whisper,
  flask-sock) are imported lazily inside the function that needs them and guarded by
  try/except, so minimal runtimes — including the Android/Chaquopy build — still boot
  with the feature simply reporting itself unavailable. Never import them at module
  top level.
