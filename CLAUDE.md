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

The app has three **channels**, chosen at `/` (see "The home screen" below), each a
group of numbered "rooms" in a frame of its own (`frontend/src/components/channels/`):
- **1 Social** — the Edition, the Wire (HN), the Dispatch (Reddit). `SocialFrame`: a
  newspaper section bar across the top (sticky; it sets `--chrome-top` so sticky
  things inside — the Edition's follow bar, the Wire's reader pane — sit under it).
- **2 Coding** — the Composing Room, the Workbench, GitHub. `CodingFrame`: an
  editor-style activity bar down the left and a mono title bar (a path, plus the
  editor's workspace root and tools when you're in it).
- **3 Video** — the Screening Room, the Anime, the Archive. `VideoFrame`: the
  wood-cabinet console down the left (room keys; the room you're in opens its own
  index under it via `PLACES`: `ScreeningIndex`, and the Anime's file tree with your
  AniList account on top, `AnimePlaces` in `components/anime/AnimeTree.jsx`). Folds to
  a rail (`tubcal.hub.console.rail`), becomes a top bar on phones.

`frontend/src/lib/rooms.js` is the canonical registry: `ROOMS` (id, label, short,
color token, route, `default_enabled` — the rooms Settings → Rooms can switch off,
`config.ROOM_IDS` on the server), `FIXED` (the Anime, always on) and `CHANNELS` (which
rooms each holds, in order). Room numbers are computed from position inside the
channel, never hardcoded; `channelRooms`/`channelHome`/`roomOfPath`/`channelOfPath`
are the helpers. Adding a room = an entry in `ROOMS` + its id in a channel + a page in
`pages/` + a route under that channel's layout in `App.jsx` (+ `config.ROOM_IDS`) + its
module (see "Modules" below). GitHub ships off by default. `db.init_db` strips retired
ids from `active_rooms`.

**Modules.** Every room is a module an install can leave out; `modules.ini` (repo root)
lists them with the files each owns (`paths`), the rooms it `needs` (the Archive needs
the Screening Room), its pyproject `extras`/`groups`, private `tools` (yt-dlp) and distro
`packages`. Everything not listed under some module's `paths` is the core. A left-out
module's files aren't on disk (install.sh's sparse checkout), so:
- Server: `server/modules.py` — `modules.has(id)`, `installed()`. A module is here when
  chosen (`TUBCAL_MODULES`, set by the launcher from the install record; unset = all),
  its `server/` paths exist and its needs are here. `api/__init__.py`'s
  `MODULE_BLUEPRINTS` registers only installed modules' blueprints; an unknown `/api/`
  path is a JSON 404. Core code imports a module's files only inside a function,
  behind `modules.has()` (`feeds._source`, `subscriptions._source`, `brain.start()`,
  `feed_index.collect_items`, `dev.videos/repos/release`, main.py's YouTube warmers,
  notifier and the anime updater). `/api/health` lists the modules, and `serve_index`
  stamps `window.__TUBCAL_MODULES__` into the page.
- Frontend: `frontend/src/build/modules.mjs` (Vite plugin) builds only chosen+present
  modules (same rules, `TUBCAL_MODULES` from install.sh), defines `__TUBCAL_MODULES__`,
  and resolves any import of a left-out module's file to an empty stand-in.
  `lib/modules.js`: `hasModule(id)` (build ∩ server), `moduleLazy`/`moduleLazyNamed`
  (React.lazy that renders nothing without the module), `missingModules()`. The core
  reaches a module only through `import()`: App.jsx's routes (gated by `has()`), the
  Video console's `PLACES`, the Anime's layout (`components/anime/AnimeSection.jsx`)
  and curtain-call host, Settings' GitHub link panel, the HN/Reddit readers in the
  Edition and `useOpenSaved`. `lib/rooms.js` filters `ROOMS`/`FIXED`/`CHANNELS` by
  module (`ALL_*` keep the full lists) and renumbers the channels, so frames, Home, the
  palette and keys rearrange themselves; a channel with no rooms disappears. Saved
  items from a left-out room stay listed (`savedChannels`) and open on the web or say
  `tubcal add <id>`. Settings → Rooms lists what isn't installed.
- Shared pieces that look like a room's live in the core so others can use them:
  `components/screening/{feed.js,tiles.jsx,SubscribeButton.jsx}`, `components/player/anime/`
  (incl. `watching.js`, `episodeList.js`), `lib/gh.js`, `lib/languages.js`,
  `splitKind` in `lib/format.js`, `components/modals/{AddSubscriptionModal,SafeHtml}.jsx`.
- `db.note_modules` (main.py) switches on, in `active_rooms`, a room whose module was
  added since the last start (and on a new DB with an explicit `TUBCAL_MODULES`, every
  chosen room); an existing DB's first run only records.
- `tests/test_modules.py` keeps it honest: manifest paths exist and don't overlap, rooms
  = modules = blueprints, the installer's embedded copy equals `modules.ini`, and no
  static/module-level import crosses into a module from outside (frontend and server).
- The phone build (no plugin, no `modules.ini` in its Python) always has every module.
Saved and Settings belong to no channel: `DeskFrame` (a bar with "Back to <the room
you came from>", remembered per tab in sessionStorage by `useRememberPlace`).
Every frame shares `components/channels/common.jsx`: `ChannelKnobs` (1 2 3),
`PocketButtons`, `SkinButton`, `openPalette()`, `openPocket(tab)`. Pages inside a
frame don't carry a title/blurb header — `SectionHead` given only children renders
just its control bar.

Keys (`components/layout/KeyboardShortcuts.jsx`): `Space g s/c/v` the channels,
`Space g a` the Anime, `Space g h` home, `Space s` / `Space ,` the Saved / Settings
drawer; `g` + letter jumps rooms. Space stays native in text fields, the editor, the
expanded player, media, and keyboard-focused controls. An element marked
`data-kbd-scope` (the drawer) confines h/j/k/l to itself.

**Saving** works on everything, and it all lands in one place:
- One `saved` table (`db.add_saved`/`update_saved`/`list_saved`), API `GET/POST
  /api/saved`, `PATCH /api/saved/<id>` (`note`, `done`), `DELETE`. Entries are
  feed-item-shaped and stored whole. A POST carrying `saved_at` (an Undo) keeps that
  date. Tests: `tests/test_api.py`.
- `lib/saveable.js` builds the items that aren't platform feed items (anime titles,
  characters/staff/studios, threads, archive moments, playlists, YouTube channels,
  subreddits, editor files, Workbench podcasts/posts/manuals, any page) and says what
  each is: `kindOf` (from `extra.kind`, else the platform), `KINDS` (label + channel),
  `channelOfItem`, `toneOf`.
- `SaveButton` (`components/ui/ItemActions.jsx`) works inside links and clickable
  tiles (it keeps the click), offers Undo when taking something off, and has a
  `label` pill form for headers. `useSaved()` has `toggleSaved`, `addSaved`,
  `removeSaved(ids, {undo})`, `updateSaved(id, {note|done})`; `toast()` takes an
  `{action}` for the Undo button.
- The drawer (`components/pocket/Pocket.jsx`, mounted once in `App.jsx`): Saved (save
  this page, find, open in place, done/remove) and Settings (skins, common switches,
  every section). `components/saved/useOpenSaved.jsx` opens any entry the right way
  (player, Reddit/HN/repo readers, in-app route, new tab) for the drawer, the Saved
  page and the command palette (which also searches saved entries).
- `pages/SavedPage.jsx`: a catalogue by channel → kind with counts, To do / Done,
  search over titles, sources and notes, sort, shelves (each kind its own layout) or a
  dense list, notes, select-many, and Export (`lib/savedExport.js`: what's shown, or
  what's selected, as a Netscape bookmarks file foldered by channel → kind, Markdown
  with done ticks and notes, or JSON; built in the page and handed to the browser's
  download, no endpoint). All view state in the URL.
- The editor opens `/editor?open=<path>` over the restored session; `<leader> b` and
  the tab strip's bookmark save the current file. The phone's Saved screen routes the
  new kinds by `kindOf` and hides desktop-only ones (files).

**The home screen** (`/`, `pages/Home.jsx` + `components/home/`) answers "what now?"
before "where to?":
- A greeting ("Late night" from 23:00), then one sentence of links saying what's waiting: new uploads, episodes
  of shows still airing, who's live, what airs next, today's paper.
- `TheSet.jsx` is a TV. Its screen is tuned to the first entry of the "pick up" queue.
  Videos and your shows' next episodes are ordered by when you last touched them
  (`watched_at` on `/youtube/continue` vs AniList's `updated_at`), topped up with fresh
  uploads. The presets below the screen are the rest of that queue: hover/focus tunes,
  press plays. The side panel holds a clock, the three channel knobs (keys 1/2/3,
  ignored while the player or editor owns the keyboard), a "coming up" slip (live
  streams, premieres, your shows' next airings) and the grille with the `tc-wordmark`
  plate. Search, Saved and Settings sit beside the greeting.
- `Guides.jsx`: Social shows today's paper plus its rooms; Coding the files left open
  in the editor (`/editor/state`), the Workbench's languages and its rooms; Video (full
  width) the newest uploads beside your AniList shelf counts, this season's six most
  popular and the Anime's doors. Each foot links to Saved filtered to that channel.
- Late (your quiet hours, else 23:00–05:00) a nightcap under the summary offers to
  let the set sleep after the next thing you play (the sleep timer's end mode), and
  says so while any sleep timer runs.
- `lineup.js` builds all of it from reads the rooms already make and cache, so the
  page adds no new endpoints.
- The screen and guides use `overflow: clip`, not `hidden`: their glow and cover wall
  spill past the edges, and a hidden box is still a scroll container that focus and
  h/j/k/l's `scrollIntoView` would scroll.

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
- `android/tools/release.sh` publishes the debug APK as GitHub release
  `phone-v<versionName>` (marked latest), which `tubcal phone` installs. Raise
  `versionCode`/`versionName` first. Every release must come from the same machine's
  debug key, or phones can't update in place.

## The Linux installer

`install.sh` (repo root) installs Tubcal for a user on most distros. Run from a
checkout it sets that checkout up *in place* (its `data/` stays the data); piped
from curl it clones into `~/.local/share/tubcal/app`. It is one bash script that
re-execs itself from `sh`, and it keeps its own state in `$TUBCAL_HOME`
(`~/.local/share/tubcal`):
- `install.conf` is the install record. The installer writes it and the launcher
  sources it. `MODULES` is the rooms installed, `KNOWN_MODULES` every room there was
  to pick (a room newer than the record gets its default). A record without `MODULES`
  predates modules: every room, the Archive per `ARCHIVE`.
- `bin/` + `tools/` hold the private yt-dlp, installed with `uv tool`. A
  `yt-dlp.conf` beside its package adds `--js-runtimes node:<abs path>`, so YouTube's
  JS challenges solve without Deno. Tubcal finds this copy first because the
  launcher puts `bin/` first on PATH, and the launcher upgrades it at most daily.
- `node/` is a private Node, only when the distro's is missing or below 20. It is
  checksum-verified against nodejs.org's SHASUMS256.
- `bin/uv` is a private uv, only when no uv ≥ 0.8 exists.

The menu lists the rooms by channel (from `modules.ini`; piped from curl, from the
copy in `embedded_manifest` at the end of install.sh, which must match) and the
options `desktop`/`autostart`/`extras`. Picking a room brings what it needs; dropping
one drops what needs it. Defaults: every room but the Archive, and GitHub is off in a
clone (on in your own checkout). Flags: `--rooms LIST` (exact), `--with`/`--without`
(rooms or options), `--add`/`--remove` (what `tubcal add/remove` run), `--list`. The
files:
- A clone is `git clone --filter=blob:none --no-checkout --depth 1`, then
  `apply_rooms` writes non-cone sparse patterns (`/*` minus each left-out room's
  paths, minus `[elsewhere]` = android/ and docs/) and checks out. Adding a room
  re-includes its paths; git fetches the missing blobs.
- Your own git checkout gets the same patterns via `git sparse-checkout reapply`
  (2.27+; changed files stay, untracked files are never touched) or `disable` when
  every room is back. A non-git folder keeps its files; the build and server still
  leave the rooms out.
- `uv sync --no-default-groups` + each room's `--extra`/`--group`; `npm run build` with
  `TUBCAL_MODULES`; yt-dlp only with the Screening Room (removed with it).

Distro packages come first when there is root, and the plan shows them before
anything runs. Fedora (and so Fedora Asahi Remix, aarch64 with 16K pages) gets
Fedora's own `nodejs`, `uv` and `python3.13`. apt/EL/Leap always use the private
Node. Every binary is smoke-tested after install, and The Archive extra is
import-tested and dropped (with a warning) when it can't load. The run ends with a
self-test: the Flask test client against a temp `DATA_DIR`, as in
`tests/conftest.py`.

**The phone.** `install.sh --phone` (what `tubcal phone` runs, and what an
interactive install offers at the end when it sees a phone) puts Tubcal for Android
on a phone over adb:
- From the repo's latest GitHub release: `tubcal-phone.apk` and `tubcal-phone.txt`
  (version, code, sha256, size, min_sdk, abis; read line by line and checked, never
  sourced), both written by `android/tools/release.sh`. `TUBCAL_PHONE_URL` points
  elsewhere; `--apk FILE` installs a local build.
- Phones are found in sysfs (an ff/42/01 interface: USB debugging on; an "MTP"
  interface only: off) and in `adb devices -l`. During an install adb is asked only
  when sysfs shows a debugging phone or adb's server already runs; a server the run
  started is stopped on exit.
- `phone_ready` waits (q stops it, five minutes at most) and says what to do for
  each state: debugging off, unauthorized, no permissions (udev), no adb (the distro
  package, asked first). Several ready phones: a chooser, or `ANDROID_SERIAL`.
- The phone's SDK and ABIs are checked against the release before the download, the
  APK against its sha256 (kept in `~/.cache/tubcal` until it's installed). Then
  `adb install -r`, and adb's failure codes become sentences. `--replace` uninstalls
  first (a copy signed with another key; it deletes the phone's data).

`packaging/linux/` holds the templates it renders (`@TUBCAL_HOME@`, `@BIN@`):
- `tubcal` is the launcher: open/start/stop/status/logs/update/rooms/add/remove/
  phone/autostart/uninstall/run. It exports `TUBCAL_MODULES` from the record for the server.
  It uses systemd `--user` when available (`TUBCAL_SYSTEMD=0` opts out), else a
  pidfile plus `setsid`. It identifies a running Tubcal by `/api/health`.
- `tubcal.desktop` and `tubcal.service` are the menu entry and the user unit.

`tubcal update` = `git pull --ff-only` (skipped when the tree is dirty) +
`install.sh --update`, which never asks for root. Test the installer in containers
(e.g. `docker run … sh install.sh --yes`), never against your real `$HOME`.

## Commands

```bash
# one-time / after dependency changes
uv sync                                   # backend deps (Python >= 3.12) + the Anime's group
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

**Entrypoint (`main.py`):** `updater.check_and_update()` (with the Anime) →
`db.init_db()` → `db.note_modules()` → `create_app()` → with the Screening Room, warm
the "picked for you" cache, backfill channel avatars and start the notifier →
`brain.start()` (the Archive's worker and the Edition's press, each if installed) →
`app.run()`.
Background warming exists so slow shelves are ready before first request.
`server/updater.py` upgrades `anipy-api` in place from PyPI on startup (allanime
rotates its site crypto and the fix ships as a release); it must run *before*
anything imports anipy, is best-effort/offline-safe, and honors
`TUBCAL_AUTO_UPDATE=0`. `server/notifier.py` polls upcoming subscribed streams and
fires a `notify-send` desktop ping ~10 min before one goes live (no-op if
`notify-send` is absent). Inside the `quiet_hours` setting (`[from, to]`, wrapping past
midnight; Settings → Playback → Night) it keeps quiet and lets that stream go.

**Caching (`server/cache.py`) is central.** Two layers (a bounded in-memory LRU,
`CACHE_MEM_MAX` entries, in front of a `cache` table in SQLite) so caches survive
restarts and a long-running server doesn't grow. Key functions: `cached(key, ttl,
fetcher)`, `cached_swr(...)` (stale-while-revalidate), `warm(...)`, `invalidate(prefix)`.
Expired rows are kept deliberately: if an upstream fetch fails, the stale payload is
served instead of erroring — this is what keeps Reddit's aggressive rate limiting from
breaking the app. TTLs live in `server/config.py`. When adding a source call, wrap it
in the cache with an appropriate TTL rather than fetching raw. Rows a week past
their fetch are pruned by `db.prune_old_data`, at startup and then daily from
`server/housekeeping.py` (wall-clock, so a suspended laptop still comes due).

**Rate limiting:** `server/httpc.py` enforces per-host minimum spacing via
`config.HOST_INTERVALS` (Reddit is throttled to one request / 3s). It also runs a
deliberately large connection pool because proxying an HLS rendition fans out into
many concurrent segment fetches to one googlevideo host.

**State & persistence:** everything lives in one SQLite file `data/tubcal.db`
(git-ignored) via `server/db.py` — subscriptions, settings (key/value), watch
history + playback progress, saved items, OAuth credentials/tokens, and all Archive
data (transcripts, chunk vectors as float32 blobs, queue/status). All DB access goes
through the functions in `db.py`; there is no ORM. `server/snapshots.py` copies the
file once a day (from `housekeeping`) to `data/snapshots/tubcal-YYYY-MM-DD.db`: SQLite's
online backup API, the cache table emptied and vacuumed out, folder 0700 and files
0600 (they hold the same tokens), the newest `snapshots_keep` kept (0 = off).
`restore(name)` snapshots the present first ("before-restore"), backs the chosen file
up over the live one while the server runs, then re-runs `init_db` and drops the cache.
Settings → Your data (`GET /api/data`, `POST /api/data/snapshot|restore`) shows the
file, what it holds and the snapshots. `android/tools/sync-data.sh` still leaves its
own `<db>.bak-<stamp>` copies beside the DB. Tests: `tests/test_snapshots.py`.

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
  parses each rendition's `sidx` into byte-range segments and `server/api/youtube.py`
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
    one (403/404/410), `api/youtube._fresh_url` re-resolves the video, at most once per
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
- `github.py` — GitHub, through two front doors:
  - The REST API: 60 requests/hr/IP without a token, 5,000 with one, counted per
    bucket (core, search, graphql, code_search). `_api` keeps those books from the
    response headers (`budget()`, shown as the room's gauge), fails fast while a
    bucket is empty, and raises `GitHubError(message, status, kind)` with a
    sentence fit to show. `_cached` revalidates with the stored ETag (a 304 is
    free with a token). API calls go through `httpc.get(..., host_limits=False)`
    / `httpc.request` (GitHub's reset header is an epoch, not seconds), always
    `anonymous=True`.
  - github.com itself, which costs no budget: `/trending` (+ `/developers`,
    `parse_trending` reads the stars gained; falls back to a created-recently
    search), `/users/<login>/contributions` (`parse_contributions`), and each
    repo's `commits.atom` / `releases.atom` (`parse_atom`).
  - GitHub trimmed its Events API in 2025: a PushEvent has no commits and a
    PullRequestEvent no title. So a followed *repo*'s feed is the two Atom feeds
    plus one issues call (issues + PRs with titles); only a followed *person*
    still reads events (`_event_text` copes with both payload shapes).
  - Ids: repos are `github:repo:<owner/name lowercased>` and releases
    `github:release:<repo>@<tag>`, so the same thing saved from trending, Atom
    or the API is one saved entry. Issues/PRs `github:issue|pull:<repo>#<n>`,
    commits `github:commit:<repo>@<sha>`, people `github:user:<login>`.
  - The account: a token in the `oauth` table, provider "github"
    (`db.set_oauth_token`), linked by taking the GitHub CLI's sign-in
    (`gh auth token`) or by pasting a PAT (`link_token` checks it against
    `/user`). The legacy `github_token` setting / `TUBCAL_GITHUB_TOKEN` still
    count. `account()` reports login + `capabilities(scopes)`: notifications need
    `notifications` or `repo` (never a fine-grained token), star/comment
    `public_repo`/`repo`, following `user:follow`. The token never reaches the
    page. Account-only calls (`notifications`, `work` = four `@me` searches,
    `stars`, `received`, star/follow/comment) cache under `github:my:<login>:`.
  - API: `server/api/github.py` (`/api/github/*`); `/feed/github` stays in
    its own blueprint in `api/github.py` (`github_feed_bp`). Tests:
    `tests/test_github.py`, `tests/test_github_normalize.py`.
- `github_local.py` — the GitHub checkouts in `EDITOR_ROOT` (one or two levels
  down): branch, changed files, ahead/behind from `git status --porcelain -b`
  (with `GIT_OPTIONAL_LOCKS=0`), and with a token whether upstream moved since
  the last fetch. `start_clone` runs `git clone --filter=blob:none` in a thread
  (progress parsed from git's stderr; private repos over ssh); `fetch` runs
  `git fetch --prune` (never touches the working tree). Without git (the phone)
  `available()` is False and the room hides it.
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
- `dev.py` — The Workbench (Coding channel, route `/dev`): one programming language per
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
is the daily synthesized paper (Social channel, route `/edition`). Architecture rule:
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
is the code editor room (Coding channel, route `/editor`): CodeMirror 6 with real modal vim
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
lazy-loaded and routed in `App.jsx` under their channel's layout route
(`SocialLayout`, `CodingLayout`, `VideoLayout` — each a frame from
`components/channels/` around its own Suspense; the Anime's routes nest inside
`VideoLayout` under `AnimeSection`, and Saved/Settings sit under `DeskLayout`) — keep
the route, the `pages/` component, and the `lib/rooms.js` entry in sync. No frame has
a tall masthead, so every room's page starts near the top of the screen. The Video
console and the Coding activity bar hang in the shell's left margin on wide screens.
Skins restyle the frames through the
`.tc-console`/`.tc-bar`/`.tc-nav`/`.tc-navitem(-on)`/`.tc-navno`/`.tc-topline`/`.tc-wordmark`
hooks (see the head of `styles/themes.css`). `Home` (eager) is `/`. CSS Modules per page/component, design tokens in `styles/tokens.css`
and `styles/themes.css`. Skins are a registry in `lib/themes.js` (`dark`, `light`,
`terminal`, `bauhaus`, `blueprint`, `aqua`, `space`, `bench`) — each is a `[data-theme]`
block overriding tokens, so component CSS restyles for free via `var(--token)`;
the saved theme is injected server-side into `index.html` on first paint. Note
`dark`/`light` are not the only two: `bauhaus` and `aqua` are light-backed as well
(`--ink` is the background), which matters for anything reading `color-scheme`.
`bench` ("Cutting Mat") is drawn from the user's own desktop. It shows Catppuccin
Macchiato windows over a teal cutting-mat backdrop, uses the system's JetBrains
Mono, and draws the current room as a lualine block. It is `desktopOnly`, so the
phone's pickers skip it (`skinsFor(phone)`). It works through a few global hooks
that only it styles:
- `.tc-main`: a page's area, which becomes a window.
- `.tc-console` and `.tc-bar`: the channels' consoles and bars (the active room is
  the lualine block).
- `.tc-strip` and `.tc-hero`: Home's lines (date, summary, hints) and greeting.
- `.tc-float`: toasts and the Saved & Settings drawer.

Anything that can land on the bare mat needs a dark backing in that skin. A room's view state (active tab,
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
J/L, arrows, 0–9, M/F/C, `<`/`>` speed, Ctrl+←/→ chapters, Shift+N next, `Z` sleep
timer, `?` help, Esc to the corner. The sleep timer (`lib/sleepTimer.js`, a moon in the
controls) is one store for the whole station, so it outlives the video it was set on:
"end of this video/episode" stops there (no Up next, no next-episode countdown, via
`ended(id, {advance:false})`), or after N minutes the player you can hear fades out
over 12s so it is silent on time, every player pauses, the picture stays dimmed until
something plays, and your volume is put back for next time. Any media element joins it
through `useSleepFade(ref, {audible, onDoze})`; the Workbench's bench radio does (a
moon dial on the radio steps the same timer).

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
  does, through `useShared`, and `components/player/anime/episodeList.js` builds the list
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

The Edition (`pages/Edition.jsx`, stories in `components/edition/Stories.jsx`) is
laid out as a front page:
- **Nameplate:** issue and date in one ear. The other ear shows your reading: a ring
  that fills, replaced by a 読了 stamp once the paper is done, and "headlines only"
  linking to the Edition's settings on a wire paper.
- **Strip:** page-turns, the back-issue drawer (`?d=`), Next unread, Mark all read,
  Recompose and a settings link.
- **The front:** the lede (headline over a picture-and-copy spread, a size down when
  it runs long), two stories down a rail, the rest of the columns ruled in a row,
  then In Brief by room. In Brief's groups take width by line count, so a long Wire
  flows into columns.
- **Follow bar:** past the nameplate, a sticky bar with progress and Next unread.
  Sticky wrapper is 0px tall; no `backdrop-filter`, which dropped its background in
  Firefox.
- **Copy:** an edited story has a dek and body (drop cap on the lede). A wire paper
  shows numbers where the dek goes, and its "body" is raw source snippets, so it
  renders as a labelled, cleaned (no links or hashtags), 3-line excerpt.
- **Keys:** `u` next unread, `[` `]` older/newer paper. Ticks are per paper in
  localStorage `tubcal.edition.read` (`components/edition/readMarks.js`).
- **Animation:** letters pressed in, the rule drawn out, stories revealed on scroll
  (`useReveal`: IntersectionObserver plus a MutationObserver for late rows; still
  screens show everything), papers swinging in from their side, the lede picture
  developing, ticks drawing, a press roller while recomposing.
- **Polling:** the presses watcher reloads only on a `built_at` it hasn't seen; an
  unconditional reload restarts the watcher and loops.
- **Layout** follows container queries `page` (the paper) and `lede`, not the
  viewport. Beside a docked console (~860–950px) the lede spans the width and the
  rail becomes a row of two.

**Fast mode** (Settings → Appearance, setting `fast_mode`) turns off every animation
and transition:
- `serve_index` stamps `<html data-fast>` so even the first paint is still, and
  `state.jsx` keeps it in sync afterwards.
- The rule in `styles/base.css` collapses animations to 1ms with no delay rather than
  removing them, so entrances still land and `animationend` (the phone's
  swipe-away) still fires. Loader and refresh spinners are exempt.
- Script-driven motion asks `lib/motion.js`: `isStill()` (fast mode or reduced
  motion) and `scrollMotion()` for `scrollIntoView` behaviour. New smooth scrolls
  and JS animations should use them.
- Tests: `tests/test_fast_mode.py`.

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

The GitHub room (`pages/Github.jsx`, `/github`) borrows git's own visual language:
lanes and nodes, release tags cut like luggage tags (`TagLabel`), short hashes,
+/− diffstat blocks. Its pieces are in `components/github/` (and `lib/gh.js`: paths,
`ghRoute` for github.com links, linguist colours, `useGhAccount`):
- Down the left, a list of refs (the views, the current one starred like `git
  branch`), the account card with the last 16 weeks of contributions, and the
  API budget. Views are `?v=`: activity (`Graph.jsx` — each day a trunk, each repo
  a branch in its language colour; busy days fold, squash commits fold into their
  PR; or the linked account's GitHub feed), releases (a rack of tags by week),
  trending (`?p=`, `?lang=`, `?tk=devs`), following (cards), clones, and with an
  account inbox / work / stars. Search (`?q=`, `?in=` repos|users|issues|code)
  sits over every view; a pasted github.com link or owner/repo opens it here.
- `/github/r/:owner/:repo` (`pages/GithubRepo.jsx`): the name plate (owner / name,
  the slash in the language's colour), tabs `?t=` readme|code|commits|issues|
  pulls|releases|people, facts down the side (52-week ridge, the local clone or
  a Clone button). Code is `?path=&ref=`; files are highlighted by `Code.jsx`
  with the editor's own grammars (`languageFor`) and `@lezer/highlight`'s
  `classHighlighter`, lines marked by `#L12-L20`; "Edit locally" opens the clone's
  copy in the Composing Room. Threads `/issues/:n`, `/pull/:n` (`?tab=files`)
  draw the conversation on a lane and can comment with a token; `/commit/:sha`;
  `/github/u/:login` (`pages/GithubUser.jsx`) has the contribution calendar
  (`Calendar.jsx`). `Diff.jsx` renders patches; `GhHtml.jsx` renders GitHub's HTML
  and routes its links in-app (relative README links open the file).
- The Coding frame's title bar carries the path into the repo, and the GitHub key
  shows unread notifications. Saved GitHub things (repo, release, issue, pull,
  commit, ghuser) open their page here (`itemPath`); the phone opens them on
  github.com. Settings → Accounts has the same link panel (`LinkAccount.jsx`).

The Anime's views (Browse, Seasons, Schedule, My List, Ledger, Community, Channel,
Social) have no header or tab strip: they're chosen from the index, a file tree
built in `components/anime/AnimeTree.jsx` that the Video console shows under "The
Anime" (`AnimePlaces`; `buildTree` is the one place the views and their sub-places —
shelves with counts, next season, Ledger anchors, the inbox badge — are listed;
`AnimeLayout` adds the one-line path bar over every anime route). It becomes chip rows
on phones. Views live in `components/anime/` with their own CSS module and a
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
- Both live in `components/player/anime/watching.js` (re-exported by WatchList.jsx), with no
  CSS attached, so the eager home screen can use them.
- What a title offers follows its shelf: next episode and +1 while watching,
  Start for Planning, the score for Completed, and a countdown when you've caught
  up on something airing.
- The register has column headings, and "Gathering dust" is folded to one line
  there (`collapsible`).

The title page's "Your list" deck is `components/anime/ListPanel.jsx` (desktop only;
the phone has its own title page):
- A shelf rail. Completing from it also marks every episode watched.
- Two wells. *Where you are* has a counter you can type into and a tape of
  episode cells (a continuous strip past 52 episodes). It also has −/+1,
  play/resume (`watchState` + `usePlayEpisode` from `WatchList.jsx`) and Finish.
  *Your score* has `ScoreDial`, the words, and how it sits against AniList's average.
- The record, an index card with tabs (`?rec=`): By category, Journal (dates,
  rewatches, time watched; `updated_at`/`created_at` come from the detail query),
  Notes, and Lists & privacy.
- Remove takes two presses.

Scores are one vocabulary across the room: `components/anime/scoring.js` holds the
pure maths (words, tens, `categoryAverage`). `Scoring.jsx` has `ScoreDial` and
`CategoryScores`, one segmented meter per advanced-scoring category. Its `confirm`
mode is read-only until Edit and writes only on Save; the phone uses it.

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
viewer's own score format), score it by category (`CategoryScores`, with the
viewer's categories from `/anime/me`; live on desktop, Edit → Save on the phone via
`__TUBCAL_APP__.phone`; an account with advanced scoring off is offered a switch),
the finale's episode thread (`ThreadView` with
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
`/anime/studio/:id`) are wrapped in a shared layout route (`AnimeSection` in `App.jsx`,
nested in the Video channel's layout) that renders `AnimeLayout`, and mounts one
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
- **Only this machine's pages.** Binding to 127.0.0.1 keeps other machines out,
  not other websites. `server/localguard.py` runs before every request (a
  `before_request` in `create_app`) and refuses a `Host` that isn't a loopback name
  (DNS rebinding), an `Origin` that isn't this machine (WebSockets ignore CORS, and
  `/api/editor/pty` is a shell), and `/api/` subresources marked `Sec-Fetch-Site:
  cross-site`. Top-level navigations pass (OAuth callbacks), and so do requests with
  none of those headers (curl, the launcher, tests). Never add CORS headers or a
  route that sidesteps it. Tests: `tests/test_localguard.py`.
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
- **Module seams.** Outside a module (modules.ini), never import its files at module
  level (server) or statically (frontend): check `modules.has()` / `hasModule()` and
  import inside the function / through `moduleLazy`. A new file in a module's folder is
  that module's; a file the core needs goes in the core. `tests/test_modules.py`.
## Important
Maintain ~/Projects/papercuts.md, a global log shared by all my Claude sessions of anything that slowed down development. When you lose time to one mid-session, append date · symptom · fix · project. Check this file first when tooling fails mysteriously. *IGNORE THIS IF THE FILE DOES NOT EXIST OR DOES NOT HAVE THE PURPOSE MENTIONED*

