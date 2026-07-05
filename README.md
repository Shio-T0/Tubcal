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

Night Edition (ink + ember) and Day Edition (true newsprint) themes.

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

- **Search**: each room has its own bar — Screening Room filters your programme,
  The Dispatch searches Reddit (all or per-subreddit), The Wire searches the full
  HN archive via Algolia.
- **Reddit without login** is served via RSS (Reddit blocks anonymous JSON): no
  scores and flattened comments. Connecting Reddit OAuth in Settings upgrades
  everything to full data automatically.
- **OAuth setup** (optional): Settings → Connections shows the redirect URIs to
  register. Google: OAuth client (Web application) with YouTube Data API v3
  enabled. Reddit: "web app" at reddit.com/prefs/apps.
- Data lives in `data/tubcal.db` (subscriptions, settings, cache, history, tokens).
  Watch history can be cleared in Settings.
- Responses are cached server-side (HN 2 min, Reddit/YouTube 5–10 min); the ⟳
  button forces a refresh.
