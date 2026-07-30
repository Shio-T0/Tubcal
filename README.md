<div align="center">

# TUBCAL

**A private broadcast station for one person.**

YouTube · Reddit · Hacker News · GitHub · AniList — plus a local second brain,
a daily synthesized paper, and a code editor — in one Flask app bound to
`127.0.0.1`.

*No accounts required. No cloud. No telemetry. The only outbound traffic is the
platforms themselves.*

`uv sync` · `npm run build` · `python main.py` → **http://127.0.0.1:5000**

</div>

---

## Quick start

You need **Python ≥ 3.12**, **Node**, and **`yt-dlp` on your PATH**. Everything
else is optional.

```bash
uv sync                                   # backend
cd frontend && npm install && npm run build && cd ..
uv run python main.py                     # → http://127.0.0.1:5000
```

That's the whole install. Open the page, add a few channels and subreddits in
Settings, and the rooms fill in.

<details>
<summary><b>Optional extras</b> — the heavier features</summary>

```bash
uv sync --extra brain     # The Archive: faster-whisper + numpy (local transcription)
uv sync --extra editor    # The Composing Room: flask-sock (PTY terminal + LSP bridge)
```

| Also nice to have | Unlocks |
|---|---|
| A running [Ollama](https://ollama.com) server | The Archive's Q&A, and the written (rather than "wire") Edition |
| `rg` (ripgrep) | Fast project grep in the editor — falls back to `os.walk` |
| `notify-send` | Desktop ping ~10 min before a subscribed stream goes live |
| A language server (`rust-analyzer`, `pyright`, …) | Completion & diagnostics in the editor |

Every one of these degrades quietly. Miss them all and the app still boots — the
feature just reports itself unavailable.

</details>

---

## The rooms

Every feature is a numbered room. The numbers aren't hardcoded — they're the
room's position in your own running order, so reordering or switching one off in
**Settings → Rooms** renumbers the rest. Below is the default set.

| | Room | What it is |
|---:|---|---|
| **01** | **The Edition** | A daily paper composed on this machine. The same story found across YouTube, Reddit and HN is clustered into one article, ranked by editorial salience (cross-platform stories win), and — with Ollama running — written up as grounded, citation-checked prose. With no AI installed at all it degrades to a "wire edition" of hard-linked URLs. Built once a day by a background thread; opening the page is a single SQLite row read. |
| **02** | **Front Page** | One mixed stream from everything you follow — newspaper lede plus ruled columns, interleaved by a deterministic weighted round-robin you can re-weight. |
| **03** | **Screening Room** | Cinematic YouTube: a hero premiere, a shelf per channel, per-channel and playlist pages, watch history and resume, English captions for foreign-language videos, and **The Projection** — a recommendation shelf built entirely from your own local watch history. |
| **04** | **The Dispatch** | Reddit as an editorial broadsheet: serif headlines, per-subreddit pages, full-text search, threaded comments. |
| **05** | **The Wire** | Hacker News as a dense amber teletype, with Algolia archive search. |
| **06** | **The Archive** | A second brain over the videos you actually watched. A background worker transcribes them with Whisper, chunks and embeds the transcripts into SQLite, and answers questions by cosine search + a local LLM. Fully offline. It has knowledge memory, not conversational memory — each answer starts fresh. |
| **07** | **The Anime** | An AniList-backed tracker, browser and player: genre/tag finder with infinite scroll, cast and voice-actor dossiers, progress synced back to your list — and **The Reckoner**, a watch-time calculator docked in the margin (hover a card, tap `C`) that tells you when you'd finish if you started now. |
| **08** | **The Composing Room** | A real code editor: CodeMirror 6 with modal vim, file tree, tabs and splits, go-to-file, project grep, git gutter and branch, a which-key leader menu, session restore, an integrated PTY terminal and an optional LSP bridge. Sandboxed to one root directory. |
| **09** | **The Workbench** | One programming language per "service manual" — Rust, Python, Go, TypeScript. Curated facts and docs, conference talks, a podcast rail that plays in the page's own bench radio, core-team blog updates, trending repos, and a best-effort "current stable" version stamp. |
| **—** | **GitHub** | Follow repositories and read releases and activity as a room. *Ships off by default* — switch it on in Settings → Rooms. |

---

## The look

Seven skins, each a `[data-theme]` block overriding design tokens — so every
component restyles for free, including the editor buffer and the terminal's ANSI
palette. Cycle them from the masthead.

| | | |
|---|---|---|
| **Shōwa Night** — warm wood cabinet, amber tube | **Shōwa Day** — same set, tatami daylight | **Phosphor Terminal** — green text on a black tube |
| **Aqua Y2K** — glossy turn-of-the-century desktop | **Bauhaus Print** — a constructivist poster | **Blueprint** — cyan hairlines on drafting navy |
| **Deep Space** — glass panels adrift over a nebula | | |

Your choice is injected server-side into `index.html`, so there's no flash of the
wrong theme on first paint.

### Keyboard

| Keys | |
|---|---|
| `h` `j` `k` `l` | Move a roving focus across tiles by geometry — works in shelves and grids alike (arrows mirror them once a tile is focused, so they still scroll the page otherwise) |
| `g` `g` / `G` | First / last tile on the page |
| `g` + letter | Jump between rooms — `ge` `gf` `gy` `gr` `gn` `gc` `gs` |
| `/` or `Ctrl-K` | Command palette |
| `C` | Add the next unwatched episode to The Reckoner (anime section) |

The global bindings stand down while you're typing, while a video is expanded, and
while the Composing Room has focus — those own their own keys.

---

## Privacy

Binds to `127.0.0.1` and nothing else. Self-hosted fonts, `youtube-nocookie`
player, no trackers, no analytics. Subscriptions, settings, watch history,
playback progress, saved items, OAuth tokens and every byte of Archive data live
in one git-ignored SQLite file at `data/tubcal.db`.

---

## Configuration

Nothing is required. Copy `.env.example` to `.env` only to override a default;
anything you'd want to change while the app is running lives in **Settings**
instead (stored in the DB, not the environment).

| Variable | Default | Purpose |
|---|---|---|
| `TUBCAL_PORT` | `5000` | Port to bind on `127.0.0.1`. |
| `TUBCAL_OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint for The Archive and The Edition. |
| `TUBCAL_INVIDIOUS` | *(auto)* | Comma-separated Invidious instances for YouTube trending/search. |
| `TUBCAL_EDITOR_ROOT` | `~/Projects` | The only directory the Composing Room can reach. |
| `TUBCAL_EDITOR_MAX_FILE_BYTES` | `4194304` | Refuse to open files larger than this. |
| `TUBCAL_GITHUB_TOKEN` | *(none)* | A classic PAT — lifts GitHub's 60 req/hr/IP ceiling to 5000. Can be pasted into Settings instead. |
| `TUBCAL_ANIME_PROVIDER` | *(auto)* | Prefer one anime scraper: `allanime` or `animekai`. |
| `TUBCAL_ANIME_WATCHED_PERCENT` | `85` | Auto-mark an episode watched on AniList past this %. `0` disables. |
| `TUBCAL_AUTO_UPDATE` | `1` | Set `0` to stop upgrading `anipy-api` from PyPI on startup. |

### Connecting accounts (all optional)

Everything works logged out. **Settings → Connections** shows the redirect URIs to
register if you want more:

- **Reddit** — logged out, Reddit only serves RSS (it blocks anonymous JSON), so
  you get no scores and flattened comments. Connecting OAuth (a *web app* at
  reddit.com/prefs/apps) upgrades everything to full data.
- **YouTube / Google** — an OAuth *Web application* client with the YouTube Data
  API v3 enabled pulls in your real subscriptions.
- **AniList** — needed for progress sync, and now for reads too: AniList began
  403-ing unauthenticated queries.
- **GitHub** — no OAuth flow; paste a classic PAT into Settings.

---

## How it works

**Caching is the load-bearing wall.** Two layers — an in-memory dict over a
`cache` table in SQLite — so caches survive restarts. TTLs live in
`server/config.py`; expired rows are kept *on purpose*: if an upstream fetch fails,
the stale payload is served instead of an error. That single decision is why
Reddit's rate limiting can't take the app down. `server/httpc.py` also enforces
per-host minimum spacing (Reddit: one request every 3s).

**YouTube quality, without an account or ffmpeg.** YouTube's open player clients
now expose exactly one muxed rendition — 360p. Everything above it ships as
adaptive DASH: video-only and audio as separate files. So Tubcal keeps 360p as an
instant floor and, for each higher rendition, parses the stream's `sidx` index into
byte-range segments and synthesizes an HLS master playlist pointing at them.
`hls.js` muxes video and audio in the browser, fetching straight from googlevideo
through the segment proxy. Real 1080p with native seeking, no transcoding, no third
party.

**Two anime scrapers, on purpose.** Episodes resolve in-process through
`anipy-api` (allanime/animekai) and fall back to a second, independent provider
returning the identical shape — two unrelated sites rarely break on the same day.
On startup Tubcal also upgrades `anipy-api` from PyPI, because allanime rotates its
site crypto and the fix ships as a release; best-effort and offline-safe.

**The Edition never computes on the request path.** A background thread builds one
JSON payload per day. LLM synthesis is capped at 6 calls per build, time-boxed, and
gated by a citation validator with a template fallback — unvalidated model output
can't reach a payload, so the paper cannot invent a story.

**The editor is sandboxed.** Every client-supplied path resolves against
`EDITOR_ROOT` and is rejected if it escapes — traversal, absolute paths, symlinks
out. Writes are atomic (temp file + `os.replace`) behind an mtime precondition, so
a stale buffer gets a conflict instead of clobbering your file; `:w!` forces.

**Heavy dependencies are lazy.** anipy, numpy, faster-whisper, rapidfuzz and
flask-sock are imported inside the function that needs them and guarded — which is
what lets minimal runtimes (down to the Android/Chaquopy build) boot at all.

---

## Layout

```
main.py                 # updater → init DB → create_app → warm caches → start workers → run
server/
  config.py             # env-driven config, cache TTLs, room ids
  db.py                 # the one SQLite file: subs, settings, history, tokens, brain
  cache.py              # TTL + stale-while-revalidate cache, persisted
  httpc.py              # shared session, per-host rate limiting, big pool for HLS fan-out
  updater.py            # self-update anipy-api before anything imports it
  notifier.py           # desktop ping before a subscribed stream goes live
  api/                  # blueprints — every response wrapped ok(data) / err(msg)
  sources/              # one module per platform's quirks (+ fmp4, mixer, fuzzy)
  brain/                # The Archive: transcribe · search · summarize · llm · worker
                        # The Edition: cluster · feed_index · edition
  editor/               # PTY terminal + stdio-JSON-RPC ⇄ WebSocket LSP bridge
frontend/src/
  lib/rooms.js          # canonical room registry — the source of the numbering
  lib/themes.js         # the skin registry
  pages/                # one lazy-loaded component per room
  state.jsx             # all shared state, as a stack of context providers
  styles/               # design tokens + one block per skin
data/tubcal.db          # everything local (git-ignored)
```

**Adding a room** is three edits kept in sync: an entry in `lib/rooms.js`, a
component in `pages/`, a route in `App.jsx`.

## Develop

```bash
uv run python main.py        # API on :5000
cd frontend && npm run dev   # UI on :5173, /api proxied

uv run pytest                # backend tests
```

Two servers in dev; in production mode Flask serves `frontend/dist` on one port —
so a UI change there needs `npm run build` and a hard refresh, and a backend change
needs a restart. There's no linter configured and no frontend tests; the deepest
coverage sits where a bug would be silent — edition clustering, editor path
containment, and the fMP4 index parser.

---

<div align="center">

*Runs on localhost, for one person, on purpose.*

</div>
