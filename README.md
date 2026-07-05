# Tubcal

Your private broadcast station: YouTube, Reddit, and Hacker News in one beautiful
localhost app — no accounts required, nothing leaves your machine.

A "midnight newsroom" design where every platform gets its own room:

- **No 01 · Front Page** — one mixed stream from everything you follow, set like a
  newspaper lede + ruled columns, weighted to your taste.
- **No 02 · Screening Room** — cinematic YouTube: a hero premiere, one shelf per
  channel, per-channel pages, and **The Projection** — a fully local
  recommendation shelf powered by your private watch history.
- **No 03 · The Dispatch** — Reddit as an editorial broadsheet with serif
  headlines, per-subreddit pages, and full-text search.
- **No 04 · The Wire** — Hacker News as a dense amber teletype with Algolia
  archive search.

## The rooms

Rooms are a configurable registry (Settings → Rooms) — reorder them or toggle
optional ones on and off.

| | Room | What it is |
|---|---|---|
| **00** | **The Edition** | A daily paper composed on this machine: the same story found across YouTube, Reddit, and HN is clustered into one article, ranked by an editor's salience (cross-platform stories win), and — with Ollama running — written up as grounded, citation-checked prose. Works with zero AI installed as a "wire edition". |
| **01** | **Front Page** | One mixed stream from everything you follow — a newspaper lede plus ruled columns, weighted toward your taste. |
| **02** | **Screening Room** | Cinematic YouTube: a hero premiere, a shelf per channel, per-channel & playlist pages, watch history, and **The Projection** — a fully local recommendation shelf powered by your own watch history. English captions for foreign-language videos. |
| **03** | **The Dispatch** | Reddit as an editorial broadsheet: serif headlines, per-subreddit pages, full-text search, threaded comments. |
| **04** | **The Wire** | Hacker News as a dense amber teletype, with Algolia archive search. |
| **05** | **The Archive** | A local second brain over the videos you watch — automatic transcription, semantic search, and on-device summaries, digests, and "ask my feed" Q&A. Fully offline (Ollama + Whisper). *Optional.* |
| **06** | **The Anime** | An AniList-backed tracker and browser: browse, search, follow, and sync progress against your AniList list. Episode playback reads from a configurable local source URL. |
| — | **GitHub** | Follow repositories and read release/activity as a room. *Optional, off by default.* |

Two skins: **Night Edition** (ink + ember) and **Day Edition** (true newsprint).
Full keyboard navigation (`hjkl` tile selection, a command palette, and shortcuts).

---

## Privacy

Binds to `127.0.0.1` only. Self-hosted fonts, `youtube-nocookie` player, no
trackers. Watch history and all settings live in a local SQLite file. The only
outbound traffic is direct fetches to the platforms themselves.

## Run

```bash
# one-time setup
uv sync
cd frontend && npm install && npm run build && cd ..

# start (everything on one port)
uv run python main.py     # → http://127.0.0.1:5000
```

## Develop

```bash
uv run python main.py        # API on :5000
cd frontend && npm run dev   # UI on :5173 with /api proxied
```

## Notes

```bash
uv run pytest
```

---

## Configuration

Copy `.env.example` to `.env` only if you need to override a default. All settings
are optional:

| Variable | Default | Purpose |
|---|---|---|
| `TUBCAL_PORT` | `5000` | Port to bind on `127.0.0.1`. |
| `TUBCAL_OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint for The Archive. |
| `TUBCAL_INVIDIOUS` | *(auto)* | Comma-separated Invidious instances for YouTube trending/search. |
| `TUBCAL_YT_COOKIES_BROWSER` | *(off)* | Have `yt-dlp` borrow a browser's YouTube cookies (e.g. `firefox`, `firefox:profile`) so resolves/captions stop getting rate-limited. Off = maximum privacy. |
| `TUBCAL_ANIME_SOURCE` | `http://127.0.0.1:3000` | *(inert)* Episodes now resolve in-process via `anipy_api`; no external aggregator is used. |
| `TUBCAL_ANIME_PROVIDER` | *(none)* | anipy provider to prefer: `allanime` or `animekai` (defaults to allanime→animekai). |
| `TUBCAL_ANIME_WATCHED_PERCENT` | `90` | Auto-mark an episode watched on AniList once this % has played (needs AniList connected; `0` disables). |

### Connecting accounts (optional)

Everything works logged-out, but **Settings → Connections** shows the redirect
URIs to register if you want richer data:

- **Reddit** anonymous access is served via RSS (Reddit blocks anonymous JSON), so
  logged-out you get no scores and flattened comments. Connecting Reddit OAuth
  (a *web app* at reddit.com/prefs/apps) upgrades everything to full data.
- **YouTube/Google** OAuth (an OAuth *Web application* client with the YouTube
  Data API v3 enabled) pulls in your real subscriptions.

---

## How it works

- **Caching** — responses are cached server-side in SQLite (HN ~2 min,
  Reddit/YouTube ~5–10 min) and survive restarts; the ⟳ button forces a refresh.
- **The Projection** — a fully local recommendation shelf built from your watch
  history, warmed in the background at startup so it's ready on first open.
- **The Edition** — a background thread composes one paper a day (after a
  configurable hour, default 06:00): feed items are embedded (one batched Ollama
  call), clustered by canonical URL + cosine similarity, ranked, and the top
  stories synthesized by the local LLM behind a citation-validation gate that
  falls back to stitched snippets — the paper can never hallucinate a story.
  Reading it is a single SQLite row: nothing is computed when you open the page.
- **Captions** — foreign-language YouTube videos get English captions fetched via
  `yt-dlp` (which carries the right client context for auto-translated tracks).
- **The Archive memory** — a background worker transcribes watched videos with
  Whisper, chunks and embeds the transcripts (float32 vectors in SQLite), and
  answers questions with brute-force cosine search + a local LLM. It has knowledge
  memory (what you watched), not conversational memory (each answer starts fresh).

---

## Project layout

```
main.py                 # entrypoint: init DB, warm caches, start workers, run Flask
server/
  __init__.py           # create_app() — Flask app + SPA static serving
  config.py             # env-driven config & cache TTLs
  db.py                 # SQLite: subscriptions, settings, history, tokens, brain
  cache.py              # SQLite-backed TTL/SWR cache (persists across restarts)
  api/                  # HTTP blueprints (feeds, subscriptions, settings, oauth, brain, anime, edition)
  sources/              # feed adapters (youtube, reddit, hackernews, invidious, anilist, …)
  brain/                # The Archive: transcribe · search · summarize · llm · worker
                        # + The Edition: cluster · feed_index · edition
frontend/
  src/pages/            # one component per room
  src/components/       # layout, player, modals, ui
  src/state.jsx         # shared app state + settings
  dist/                 # built assets served by Flask (git-ignored)
data/tubcal.db          # all local state (git-ignored)
```

---

*Runs on localhost, for one person, on purpose.*
