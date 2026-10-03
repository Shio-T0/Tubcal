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

The app has two "channels", chosen at `/` (`pages/Home.jsx`, a TV-style chooser):
**the Hub** and **the Anime**. The Hub is a set of numbered "rooms" beside the hub
console; `frontend/src/lib/rooms.js` is their canonical registry (id, label, color
token, route, `default_enabled`) — the numbers users see are computed from list
position, not hardcoded, so adding a room means adding an entry there plus a page in
`pages/` (and the id to `config.ROOM_IDS`). Rooms are toggleable in Settings → Rooms (`/settings?s=rooms`);
GitHub is the one that ships off by default. The Anime is *not* a room: it's its own
section with its own top bar (`components/anime/AnimeMasthead.jsx`) and index (see
below). The old Front Page room is gone; `db.init_db` strips retired ids from the
saved `active_rooms`. Global chords `Space g h` (Hub → /edition) and `Space g a` (the
Anime) live in `components/layout/KeyboardShortcuts.jsx`; Space stays native in text
fields, the editor, the expanded player, media, and keyboard-focused controls.

**The Android app lives in `android/`**: a Gradle project with Chaquopy and Kotlin
(`app/`), a separate phone UI (`phone/`, Vite + React) and tools (`tools/`).
- Nothing desktop is copied there. Gradle's `syncDesktopPython` packs the root
  `server/` and `main.py` (as `desktop_main.py`) into the build.
- `phone/` imports `frontend/src` in place as `@pc`. Its `resolve.dedupe` keeps
  every npm package coming from `android/phone/node_modules`.
- Gradle's `buildPhoneUi` builds it into the APK's assets.
- So a change to `server/` or `frontend/src` reaches the phone on its next build.
  A desktop markup change can break the `pc_<dir>_<file>__<class>` overrides in
  `android/phone/src/styles/phone.css`.
- Server code must also run on the phone's Python 3.11.
- Heavy optional imports stay lazy (Chaquopy has no wheels for many).
- `android/app/src/main/python/` holds only the Android shims and the vendored
  anipy_api/weeb_cli, with their LICENSE and NOTICE.
- Build: `cd android && ANDROID_HOME=~/Android/Sdk ./gradlew :app:assembleDebug`.
- `android/tools/sync-data.sh` moves user data between the desktop and phone
  databases.

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
- `youtube.py` — RSS for subscriptions (no API key needed), `innertube.py` for
  search, `invidious.py` for trending (and as the search fallback), `yt-dlp` (must
  be on PATH) for stream resolution and captions.
  `get_discover()` builds "The Projection" recommendation shelf from watch history.
  `youtube.search()` owns the search routing: `innertube.py` talks to YouTube's own
  `youtubei/v1/search` with the WEB client context — one unauthenticated POST,
  sub-second, no key and no middleman — and Invidious sits behind it only as a
  fallback, since its public instances now answer search with 401/403/429 far more
  often than with results. Pagination is by continuation token (the response's
  single `continuationItemRenderer`), passed back through `?continuation=`;
  `?page=N` is still carried so the token-less Invidious fallback can keep
  numbering. A *genuinely* empty result is distinguished from an unreadable
  response (`twoColumnSearchResultsRenderer` present = a real results page) so an
  ordinary no-match query returns `[]` fast instead of grinding through every dead
  instance to report the same emptiness — that cascade was the "signal lost —
  All Invidious instances failed" error. Thin result sets are topped up by
  `_fuzzy_augment` from cached subscription feeds. Tests: `tests/test_search.py`.
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
  **Playback resilience.** A googlevideo URL is IP-bound and expires, and the
  playlist freezes it in at open time. So:
  - Adaptive segment proxy URLs carry `&v=<video_id>`. When googlevideo refuses
    one (403/404/410), `feeds._fresh_url` re-resolves the video, at most once per
    ~20s, and takes the same itag (same file, so the byte range still lines up).
    `_FRESH` remembers the swap for later segments.
  - `httpc.stream_get` retries drops, timeouts and 5xx/429.
  - `server/api/relay.py` resumes a body that breaks mid-way from the exact byte
    it reached, so the player never sees a truncated segment. The anime proxy uses
    the same retries and resume.
  - On the client, `lib/hlsPlayback.js` (shared with the phone app):
    - patient load policies and a deeper buffer;
    - a fatal-error recovery budget per minute rather than per video;
    - a stall watchdog that restarts a stopped loader;
    - a position-preserving rebuild.
    It reports `onGiveUp` only after rebuilds fail. A "Reconnecting…" hint shows
    only while playback is actually stuck, and `onPlaying` clears any stale
    error. Tests: `tests/test_media_relay.py`.
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
  **Rate budget:** AniList currently allows 30 requests/min (not the documented 90).
  `_post` records `X-RateLimit-Remaining` and, on a 429, starts a cooldown during
  which calls fail fast (so stale cache is served at once); the fan-out walkers
  (`relations_batch`, the schedule/season page loops) check `_budget()` between
  batches and stop early, returning partial results. `relations_batch` caches each
  title's relation edges on its own key via `cache.cached_many` (12h) and fetches
  misses `id_in` 25 at a time — the sequel radar (`sequel_radar`/`find_sequels`) and
  the watch-order guide (`franchise`/`build_franchise`, main line = largest
  SEQUEL/PREQUEL cluster of TV/ONA/movies) both walk it. Other pure, unit-tested
  pieces: `build_media_filter` (every finder filter → GraphQL; enums validated since
  one bad enum fails the whole query), `compute_stats` (the Ledger, computed from the
  list itself because AniList's own statistics come back empty for some accounts),
  `compare_lists` (affinity = Pearson of shared scores), `norm_notification`,
  `validate_review`. Detail-page extras (rankings, stats, staff, trends, reviews,
  links, schedule) are a *second* request (`media_extras`) to stay under AniList's
  query-complexity limit. Field names were verified against a live introspection
  dump; re-introspect rather than guess when adding a query. Tests: `tests/test_anilist.py`.
- `anime_source.py` — resolves the episode list + playable streams. Its sources,
  in order: **`hianime.py`** (hianime.at + its ZokoAnime embed — what ani-cli 5.1
  moved to), then `anipy_api` (allanime/animekai — allanime answers
  `AA_CRYPTO_STALE` and anipy 3.10 dropped it from its registry, so this only
  helps if a later release revives it), then `weeb_fallback`. hianime's embed is
  addressed by **MAL id + episode** (`zokoanime.video/stream/mal/<mal>/<ep>/<sub|dub>`),
  which AniList carries, so the episode list is numbered from AniList's aired count
  after one probe, and playback needs no title search; titles without a MAL id walk
  hianime the way ani-cli does (search → episode list → servers → the ZokoAnime
  `data-hash`). The embed's `window.__P` is base64 JSON XOR-ed with
  `otaku-embed-v1`; it holds the HLS master, every subtitle track and intro/outro
  timings (→ `skip`). Segments are plain MPEG-TS; the subtitle host wants the
  embed origin as Referer (`/api/anime/sub?r=`). `watch()` returns
  `{sources,subtitles,headers,skip,audio,audio_options}`; old allanime-era keys are
  re-addressed through the AniList id's MAL id. Every source's failure is
  collected into the error, which the player shows. The old `TUBCAL_ANIME_SOURCE` /
  `anime_source_url` setting is inert. Tests: `tests/test_hianime.py`.
  Auto-watched: the anime player reports progress under item ids
  `anime:<anilist_id>:<episode>`, so `feeds.post_progress` piggybacks on those
  POSTs and, once past `ANIME_WATCHED_PERCENT` (default 80), advances AniList
  progress via `anilist.mark_episode_watched` (advance-only, in a background
  thread, once per episode per run) — no extra client call.
- `animethemes.py` — a title's openings/endings from AnimeThemes, looked up by
  AniList id (one filtered request, no key), served at `/api/anime/themes/<id>`
  and cached a day (an empty answer 6h: an airing show's OP often lands days late).
  The title page's `components/anime/ThemePlayer.jsx` plays the opening covering
  your next episode straight from AnimeThemes' audio CDN. Spans overlap in their
  data (OP1 "1-" after OP2 took over at 14), so the latest-starting cover wins.
  Settings `anime_theme_audio` / `_volume` / `_seconds` gate the autoplay; it
  fades out when a video opens or comes to the front, the tab hides, or the page
  unmounts. The chip stays as a manual player either way.
  Tests: `tests/test_animethemes.py`.
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
unvalidated model output into a payload. The **lede alone** gets a transcript block:
if its top-ranked item is already transcribed in The Archive, `_transcript_block`
attaches that video's stored TL;DR plus the `EDITION_TRANSCRIPT_CHUNKS` parts most
relevant to the headline (`search.rank_doc_chunks` — doc-scoped cosine, returned in
transcript order), capped at `EDITION_TRANSCRIPT_CHARS`, so the copy desk writes from
what was *said* rather than from a title and whatever description the platform
published. Falls back to the transcript's opening when the doc has no usable vectors,
and to no block at all otherwise; it never raises, and it costs one embed call, not an
extra chat call. Columns deliberately stay on the cheap prompt. The story records
`transcript_of` (the item id read in full, or null). Degrades: no numpy/Ollama → "wire" edition
(URL hard-links only) → embed model adds semantic clusters → chat model adds prose.

**The Archive (`server/brain/`)** is optional and fully local. A background `worker`
transcribes watched videos with faster-whisper (`transcribe.py`), chunks + embeds
transcripts into SQLite (`search.py` does brute-force cosine over `brain_all_vectors()`),
and answers via a local Ollama server over plain HTTP (`llm.py`, no client lib). It has
knowledge memory (the transcript corpus), not conversational memory — each answer is
fresh. Requires the `brain` extra and a running Ollama server; degrades gracefully when
absent.

`summarize.ask()` is two-stage, because a retrieved chunk is a ~45s keyhole and the
sentence that answers the question is often just past its edge. Stage 1 hands the
model the numbered excerpts and asks (JSON-only, `temperature=0`) which
`BRAIN_ASK_EXPAND` (default 3, `0` disables) are worth a closer read; stage 2 re-renders
those with `BRAIN_ASK_EXPAND_RADIUS` chunks either side attached
(`db.brain_chunk_window`) and asks for the answer. So it is two LLM calls per question,
both local. Anything malformed from stage 1 — bad JSON, wrong types, out-of-range
indices, an unreachable Ollama — falls back to the top-scoring excerpts rather than
failing the ask; validate model output, never trust it (same rule as The Edition).
Each excerpt carries its provenance: title, **channel**, timestamp span, position in
the video (`part n/total`), video length, watch date, rewatch count, transcript
language, retrieval score, and — once per video, on its first excerpt — that video's
stored TL;DR. Those come from `db.brain_context()`, a small keyed-by-item_id lookup
kept deliberately *out* of `brain_all_vectors()`, which scans the whole corpus on every
query and must stay narrow. Windows are deduped against every other excerpt's chunks so
no passage is ever sent twice. The response's `expanded` list marks which citations got
the deep read; the UI rings those chips. Tests: `tests/test_brain_ask.py`.

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
One page component per "room" in `pages/` (Edition, ScreeningRoom, Dispatch, Wire,
Archive, Composer, Github, Workbench, plus SavedPage and SettingsPage), all
lazy-loaded and routed in `App.jsx` under `HubLayout` (the hub console + its own
Suspense) — keep the route, the `pages/` component, and the `lib/rooms.js` entry in
sync. The hub has no masthead: `components/layout/HubConsole.jsx` (`HubFrame`) is a
sticky panel down the left — wordmark, Channel 1/2 switch, a search button that opens
the command palette (`openPalette()` fires `tubcal:palette`), the rooms as numbered
preset keys, Saved/Settings/skin — so every room's page starts at the top of the
screen. The room you're in opens its own index under it: a room opts in by adding a
component to `PLACES` there (only the Screening Room has one so far). Like the anime
index it hangs in the shell's left margin on ≥1780px, folds to an icon rail
(`tubcal.hub.console.rail`), and becomes a top bar on phones. Skins restyle it through
the `.tc-console`/`.tc-nav`/`.tc-navitem(-on)`/`.tc-navno`/`.tc-topline`/`.tc-wordmark`
hooks at the end of `styles/themes.css`. `Home` (eager) is `/`; the Anime routes sit under `AnimeSection`. CSS Modules per page/component, design tokens in `styles/tokens.css`
and `styles/themes.css`. Skins are a registry in `lib/themes.js` (`dark`, `light`,
`terminal`, `bauhaus`, `blueprint`, `aqua`, `space`) — each is a `[data-theme]`
block overriding tokens, so component CSS restyles for free via `var(--token)`;
the saved theme is injected server-side into `index.html` on first paint. Note
`dark`/`light` are not the only two: `bauhaus` and `aqua` are light-backed as well
(`--ink` is the background), which matters for anything reading `color-scheme`. A room's view state (active tab,
filters, search) belongs in the query string, not `useState` — opening a detail
route unmounts the room, so local state is lost on back. `useParamState` in
`lib/urlState.js` (re-exported by `components/anime/shared.jsx`) is the reference: it writes with `replace` (a filter toggle is
not a destination) and drops default values from the URL. It builds every write on
`latestParams()` (the live `window.location`), because React Router's functional
`setSearchParams` gets the *render's* params — two writes in one handler would
otherwise clobber each other; any hand-rolled `setSearchParams` should do the same. The video player (`components/player/`)
uses `hls.js`. Full keyboard nav + command palette in `components/layout/`.

The player (`PlayerLayer.jsx`) keeps one `<video>` per open video and only restyles
the card between expanded and docked, so playback never restarts. Expanded is a
theatre: a dark backdrop with the thumbnail blurred into an ambient glow, the picture
sized to the largest 16:9 that fits with `WatchInfo.jsx` under it (title, channel face
+ subscribers + `SubscribeButton`, Save / copy-link-at-this-second / YouTube, the
window buttons), and `NotesPanel.jsx` beside it (a sheet over it under 1100px):
About (stats, the description through `richText.jsx`, tags, the up-next queue),
Chapters, Comments (`VideoComments.jsx`), and the Archive's Transcript (follows the
playhead) and Summary. `richText.jsx` makes descriptions and comments live without
ever injecting HTML — Invidious comment HTML is walked with an allow-list: a
timestamp seeks, a link to another video opens it in the player (details fetched
first via `watchLinks.js`), a hashtag or channel opens it in the Screening Room.
Video metadata comes from `youtube.video_meta` (pure, tested): chapters, the
"most replayed" heatmap (normalised 0–1 per slice, drawn as a ridge over the seek
bar in `PlayerControls.jsx`, which also cuts the bar at chapter breaks), subscriber
count, comment count, tags. The card and the notes share that one request through
`lib/useShared.js`. Comments are `/youtube/comments/<id>?sort=top|new&continuation=`
(`{comments, continuation, count}`); each carries the author's face and channel id
and the creator/verified/member/hearted/edited marks. Keys while expanded: Space/K,
J/L, arrows, 0–9, M/F/C, `<`/`>` speed, Ctrl+←/→ chapters, Shift+N next, `?` help,
Esc to the corner.

**Settings** (`pages/SettingsPage.jsx`) is an index plus one open section:
- `pages/settingsSections.js` lists the sections, their groups and the words
  "Find a setting" matches. Each index entry shows the section's current state.
- `?s=<id>` opens a section and pushes history.
- Below 820px (the phone) the index is the page and each section opens as its
  own page. The phone build's `__TUBCAL_APP__.phone` drops desktop-only sections
  (the Composing Room).
- Every setting is a `Row` (label + hint left, control right) inside a `Group`:
  `Switch` for on/off, `Choice` for named options.

**Subtitles** are drawn by Tubcal, not the browser:
- `components/player/Subtitles.jsx` has `SubtitleOverlay`. It sets the chosen
  `<track>` to `hidden`, so the browser still parses the WebVTT and updates
  `activeCues`, then draws the active cues over the picture.
- The look is one `subtitle_style` setting: `lib/subtitleStyle.js` holds the shape
  and limits; `server/api/settings.py`'s `subtitle_style()` validates, clamps and
  stamps `updated_at`.
- `useSubtitleStyle` shares an edit in progress with every player and editor, and
  saves after a pause.
- `pickTrack` chooses the first track from the preferred language and on/off choice.
- `SubtitleStyleEditor` appears in the player's Subtitles menu and in Settings, and
  the phone app uses the same pieces.
- Never put `default` on a `<track>`; the overlay owns the tracks' modes.

An **anime episode** gets its own player, built from `components/player/anime/`:
- Accent: the card's `--signal` is set to the show's colour (`showAccent`), so the
  scrubber and cues retheme with no forked CSS.
- `AnimeStrip` replaces `WatchInfo`. It shows the show, the episode number and
  title, a Sub/Dub switch (`audio_keys` from `/anime/stream`), AniList sync state,
  and previous/next episode.
- `EpisodeRail` replaces the notes panel.
- `SkipCue` gives "Skip opening" / "Next episode" from the source's timings, with
  auto-skip as setting `anime_auto_skip`; those timings also become chapters.
- `NextUp` is an 8s countdown into the next episode when one ends.
- `useAnimeShow` reads the same `/anime/media` + `/anime/episodes` the title page
  does, through `useShared`, and `components/anime/episodeList.js` builds the list
  and player items for both.
- Switching episodes is `close()` + `open()`. A Sub/Dub choice sticks per show for
  the session (`rememberAudio`; the key's `l` field is rewritten by `keyWithAudio`).

The Screening Room (`pages/ScreeningRoom.jsx`, `/youtube`) opens on a control bar
(search all of YouTube — `?q=` —, the views, add channel, refresh) with no title or
blurb. Views are `?v=`: the programme (the newest upload on a big screen beside a "just
in" list and anything live, then continue watching, the Projection, one shelf per
channel busiest-first with "quiet lately" ones folded into chips, and a random reel),
`latest` (every upload in day groups, `?ch=` channel filter, `?hw=1` hide watched,
play-all, mark-seen) and `live`. Its pieces live in `components/screening/`: `tiles.jsx`
(`VideoTile`, `VideoRow`, `Shelf`, `Wall` — anything that shows a YouTube video uses
these, SavedPage included), `feed.js` (`useShared`, a small deduping client cache so the
console index and the page share one feed request; `useSeen` — "new" is per channel,
until you watch it or open the channel, kept in localStorage `tubcal.screening.seen`),
and `ScreeningIndex.jsx` (the console index: views with counts, up next, channels with
new counts). Tiles carry an up-next button (`QueueButton`) that feeds `usePlayer`'s
queue, which auto-advances when a video ends. Channel, playlist and history pages keep
their tab/sort/search in the URL too.

The Edition (`pages/Edition.jsx`) is laid out as a front page: a nameplate (issue +
date and sources/status in its ears) over a strip of page-turns, the back-issues
drawer (`?d=` for any past paper), a read-progress bar and Recompose; then the lede
(large, picture, drop cap when there's copy) with two more stories down a rail, the
remaining columns ruled in a row, and In Brief grouped by the room each line came
from. A "wire" paper (no model) has no dek/body, so every story shows its numbers
(points, comments, age, source) in the dek's place. Each story has per-platform
actions (Watch / Up next, Read ↗ + the HN discussion, the Reddit post) and a
section kicker ("The Wire · domain"). Opened stories are ticked per paper in
localStorage `tubcal.edition.read`. Layout switches on the page's own width
(container queries), not the viewport.

The Wire (`pages/Wire.jsx`) is a teletype board over HN's six lists (`?l=`
top/best/new/ask/show/job — `hackernews.LISTS`; the last one chosen is also saved
as the `hn_list` setting) and an Algolia search (`?q=`, `?by=date`, `?t=` day/week/
month/year window → `hackernews.search_url`). Lines show domain, a points-per-hour
heat gauge and comment counts with "+N" since your last visit; read stories dim.
The open story is `?s=<hn_id>` (pushes history): its discussion opens beside the
board in `components/wire/HNReader.jsx` when the page is ≥980px wide, otherwise as a
`ReaderSheet` — the same sheet the Edition and Saved use for HN stories. The reader:
article button, Ask/Show post text (`story.text_html`), OP marks, click-a-rail to
fold, fold-all, and comments new since your last visit marked with a chip that
walks through them (`components/wire/seen.js`, localStorage `tubcal.wire.seen`).
HN HTML goes through `HnHtml.jsx` (allow-list walk, ">" paragraphs drawn as quotes,
HN item links opened in the reader). Tests: `tests/test_wire.py`.

The Anime's views (Browse, Seasons, Schedule, My List, Ledger, Community, Channel,
Social) have no header or tab strip: they're chosen from the index, a file tree down
the left built in `components/anime/AnimeTree.jsx` (`buildTree` is the one place the
views and their sub-places — shelves with counts, next season, Ledger anchors, the
inbox badge — are listed; `AnimeLayout` renders index + path bar + page for every
anime route). On ≥1780px screens the index hangs in the shell's empty left margin so
content keeps the full 1280 shell; it folds to an icon rail (with flyouts) and becomes
chip rows on phones. Views live in `components/anime/` with their own CSS module and a
deliberately different layout; `pages/Anime.jsx`'s default export only renders the
view the URL names; card/badge/URL-state helpers they all share are in
`components/anime/shared.jsx` (not in `pages/Anime.jsx`), charts in
`components/anime/charts.jsx` (single-series in `--c-anime`, CSS tooltips via
`data-tip`, a table twin for each). Heavy detail-page sections (the franchise guide)
load on `useInView` to save AniList budget. My List's titles are `components/anime/WatchList.jsx`, in poster or register
(`?view=rows`) form:
- `watchState` is the pure "where you are": watched / aired / total, what's left
  and how long, the next episode, a half-watched episode to resume, and the next
  airing.
- `usePlayEpisode` plays an episode from the list through `/anime/episodes`
  (warmed on hover), with the same `episodeItem` as the title page.
- What a title offers follows its shelf: next episode and +1 while watching,
  Start for Planning, the score for Completed, and a countdown when you've caught
  up on something airing.
- The register has column headings, and "Gathering dust" is folded to one line
  there (`collapsible`).

The title page's episode section is
`components/anime/Episodes.jsx`. A desk works out where you are from AniList
progress *and* local resume points, and shows a per-episode reel. Below it is a
contact sheet of tiles: AniList stills, or a numeral "slate" when an image is shared
by several episodes (that's series art, not a still). Long-runners page in fifties
(`?eps=`), opening on your stretch.

Social (`?tab=discuss`, `components/anime/SocialDesk.jsx`) is a desk bar (you, your
counts, the faces you follow, Inbox / Post / New thread) over one of: the forum
(`Forum.jsx` — master-detail: thread list left, `ThreadView` from `Thread.jsx` in a
sticky pane right; the open thread is `?t=` and *pushes* history so Back closes it;
read receipts per thread in localStorage), the activity stream (`Activity.jsx` —
a timeline; anime-only via `anilist._activity_filter`, a person's own stream adds
messages), the inbox, or people (following / followers / find). People are drawn
one way everywhere by `Person.jsx`: `PersonAvatar` (ring = their AniList profile
colour, initials fallback, supporter mark — `_norm_user` carries `color`/`donator`
for this), `UserLink` (name → `/anime/user/:name`, with a lazy hover card from
`/user/<name>/card`), `FollowButton`, `PersonCard`; `asPerson()` turns `/anime/me`
into the same shape. Full pages: `/anime/user/:name` (`pages/AnimeUser.jsx`, the
profile; your own opens `ProfileStudio`), `/anime/thread/:id` and
`/anime/activity/:id` (`pages/AnimeThread.jsx`, where inbox rows land). Every
writing box is `MarkdownComposer` (`Composer.jsx`): toolbar + shortcuts, localStorage
drafts, and a live preview of the post *as others will see it* — rendered in the
browser per keystroke (`markdown.js`, AniList's dialect) then swapped for AniList's
own render on a pause (`POST /anime/markdown`, ≥8s apart per box, memoised
server-side in `_MD_MEMO`). All AniList HTML goes through `RichText.jsx`'s
`sanitizeAniHtml`/`AniHtml` (allow-list, veiled spoilers, AniList links routed
in-app). Posting returns AniList's rendered HTML, so new comments/replies/statuses
are inserted in place instead of refetching.

The curtain call (`components/anime/CurtainCall.jsx`) is the screen after you
finish a season: rate it (a 1–10 tile row with words, or stars/faces, in the
viewer's own score format), the finale's episode thread (`ThreadView` with
`composerFirst`; or start that thread if AniList has none), an inline `ReviewForm`
(its score seeded from the rating, drafts kept in localStorage), and the next ≤3
sequels one tap from Planning/Watching — or a "終 · series finished" card. The
trigger lives in `state.jsx`'s `flushAnime`: an edit touching progress/status that
comes back from AniList as COMPLETED (AniList completes an entry itself when
progress reaches the finale) dispatches `anime-completed` unless the entry was
already completed. `CurtainCallHost.jsx` (mounted at the app root, lazy-loads the
screen) queues those, waits while the player is expanded, and shows an automatic
call once per title and only for a FINISHED season; the title page's "Curtain call"
button opens it by hand (`openCurtainCall`). Data: `GET /anime/finale/<id>` →
`anilist.finale` = media() + viewer score format + `episode_thread` (Release
Discussion threads matched by `match_episode_thread`) + `sequel_chain` (SEQUEL hops
via `pick_sequel` over the cached `relations_batch`) + your list status for each.

The anime routes (`/anime`, `/anime/:id`, `/anime/voice/:id`, `/anime/character/:id`,
`/anime/studio/:id`) are wrapped in a shared layout route (`AnimeSection` in `App.jsx`) that
renders the Anime top bar and `AnimeLayout`, and mounts one
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

- **Licensing.** Tubcal is GPL-3.0-or-later (`LICENSE`). Anime playback builds on
  GPL-3.0 projects (ani-cli's method, anipy-api, weeb-cli), credited in
  `THIRD_PARTY_NOTICES.md`. Add a runtime dependency or a borrowed method there too.
  `frontend/src/build/legal.mjs` is a Vite plugin that writes `dist/legal/`: the
  licence, the notices, and every bundled npm package's licence text. Settings → About
  shows them, as GPL §5d asks of an interactive program. It sits under `src/` so the
  Android build gets it through its `pc/` copy, which sets its own `__TUBCAL_APP__`.

- Backend API endpoints return `ok(data)` / `err(msg, status)` — never bare `jsonify`.
- New external fetches go through `server/httpc.py` and are wrapped in `server/cache.py`
  with a TTL constant added to `server/config.py`.
- **Cookie containment.** `httpc`'s `session` is shared process-wide, so its jar
  accumulates whatever hosts set — scraping a YouTube channel page seeds
  `VISITOR_INFO1_LIVE`/`YSC`/`__Secure-YNID`, which requests then merges into every
  later call to that host. For anonymous reads that is a linkability leak: one
  stable pseudonymous id spanning search, feeds and playback. So `httpc.get`/`post`
  take `anonymous=True`, routing through `anon_session` whose policy neither stores
  nor sends cookies; an *explicit* `Cookie` header still goes out, which is what
  keeps the YouTube consent cookie (`SOCS`) working. Every YouTube read is
  anonymous — the only deliberate exception is `get_account_channel_ids`, which
  carries the user's own OAuth bearer token. Playback (googlevideo) is anonymous
  too, defensively: that's a different domain so the youtube.com jar never reached
  it, but the property shouldn't depend on that. `tests/test_httpc_anon.py` AST-sweeps
  `youtube.py` and fails if any call site is neither anonymous nor authenticated.
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
## Important
Maintain ~/Projects/papercuts.md, a global log shared by all my Claude sessions of anything that slowed down development. When you lose time to one mid-session, append date · symptom · fix · project. Check this file first when tooling fails mysteriously.

