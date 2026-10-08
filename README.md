<div align="center">

# Tubcal<sub>.</sub>

### A private broadcast station for one person.

YouTube · Reddit · Hacker News · GitHub · AniList — a daily paper written on your own
machine, a second brain over what you've watched, and a vim-handed code editor.<br>
One Flask app, bound to `127.0.0.1`.

![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-3b2a1a?style=flat-square&logo=python&logoColor=e6ab5e)
![React 19](https://img.shields.io/badge/react-19-3b2a1a?style=flat-square&logo=react&logoColor=e6ab5e)
![Flask](https://img.shields.io/badge/flask-backend-3b2a1a?style=flat-square&logo=flask&logoColor=e6ab5e)
![SQLite](https://img.shields.io/badge/sqlite-one%20file-3b2a1a?style=flat-square&logo=sqlite&logoColor=e6ab5e)
![Localhost only](https://img.shields.io/badge/binds-127.0.0.1%20only-3b2a1a?style=flat-square)
![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-3b2a1a?style=flat-square)

*No accounts required · no cloud · no telemetry — the only outbound traffic is the platforms themselves.*

[Quick start](#-quick-start) ·
[Installation](#-installation) ·
[Two channels](#-two-channels) ·
[The Hub](#-channel-1--the-hub) ·
[The player](#-the-player) ·
[The Anime](#-channel-2--the-anime) ·
[Keyboard](#-keyboard) ·
[Privacy](#-privacy) ·
[Configuration](#-configuration) ·
[How it works](#-how-it-works)

</div>

---

## ⏻ Quick start

```bash
git clone https://github.com/Shio-T0/Tubcal.git && cd Tubcal && ./install.sh
tubcal    # start it and open http://127.0.0.1:5000
```

Open the page, pick a channel, add a few YouTube channels and subreddits in
**Settings**, and the rooms fill in. Other ways in, what the installer does, and how to
install by hand are under [Installation](#-installation).

---

## 📦 Installation

### The installer

```bash
git clone https://github.com/Shio-T0/Tubcal.git && cd Tubcal && ./install.sh
```

Or without cloning first (it clones into `~/.local/share/tubcal/app`):

```bash
curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash
```

It opens on a test card that reads your system, lets you pick the optional parts,
and shows its running order (including the exact distro command, if one is needed)
before anything runs. Then:

1. **Distro packages:** only what's missing, with sudo asked for once and used for
   nothing else.
2. **uv, Node.js and Python 3.13:** the distro's own when it has recent enough ones.
   Otherwise a private uv, a checksum-verified Node 24 LTS and a uv-managed Python,
   all under your home.
3. **The backend and the frontend:** `uv sync` with your extras, then a production
   build of the frontend.
4. **A private yt-dlp:** Tubcal's own copy, refreshed at most once a day, set up to solve
   YouTube's JS challenges with Node. Your own yt-dlp, if you have one, is untouched.
5. **The `tubcal` command, an app-menu entry, and a user service** (systemd, where
   there is one).
6. **A self-test:** the app is booted against a throwaway database and has to serve
   the page and answer its API.

Run it again at any time: it repairs, and it remembers what you chose. Your data
(`data/tubcal.db`) is never touched.

### Where it runs

| | Distro packages | Node.js | uv | Python 3.13 |
|---|---|---|---|---|
| **Fedora Asahi Remix** (Apple Silicon) | dnf | Fedora's | Fedora's | Fedora's |
| **Fedora** | dnf | Fedora's | Fedora's | Fedora's |
| **RHEL · AlmaLinux · Rocky** | dnf | private | private | uv's |
| **Debian · Ubuntu** and derivatives | apt | private | private | uv's |
| **Arch** and derivatives | pacman | Arch's | Arch's | uv's |
| **openSUSE Tumbleweed** | zypper | openSUSE's | private | uv's |
| **Alpine** | apk | Alpine's | Alpine's | uv's |
| **Void** | xbps | Void's | Void's, else private | uv's |
| **Silverblue · Kinoite · Bazzite** | — | private | private | uv's |
| anything else, or no root | — | private | private | uv's |

On Apple Silicon, Fedora Asahi runs a 16K-page kernel, which some prebuilt binaries
don't survive. So the installer prefers Fedora's own aarch64 builds there and
smoke-tests every binary it relies on. If The Archive's speech models can't load, it
leaves that feature out and says why. Tested in containers on Fedora 44 (x86-64, and
arm64 posing as Fedora Asahi Remix), AlmaLinux 9, Debian 12, Ubuntu 24.04, Arch,
openSUSE Tumbleweed and Alpine 3.24.

### Choices

| Component | Flag | What it is |
|---|---|---|
| Composing Room terminal & LSP | `editor` | flask-sock: a real shell and language servers in the editor room *(on by default)* |
| The Archive | `archive` | faster-whisper transcription of what you watch, about 300 MB *(off by default)* |
| App-menu entry & icon | `desktop` | launch Tubcal like any other app *(on)* |
| Start when I log in | `autostart` | a systemd user service, or XDG autostart *(off)* |
| Live-stream pings & fast grep | `extras` | `notify-send` and `ripgrep` from your distro *(on when there's root)* |

```bash
./install.sh --yes                                # no questions: defaults, or your last choices
./install.sh --with archive,autostart --without extras
./install.sh --no-sudo                            # never ask for root; everything in your home
curl -fsSL …/install.sh | bash -s -- --yes        # flags work through curl too
```

`./install.sh --help` lists the rest (`--dir`, `--no-anim`, `--no-color`, and the
`TUBCAL_REPO` / `TUBCAL_BRANCH` / `TUBCAL_HOME` / `TUBCAL_BIN_DIR` variables).

### The `tubcal` command

| | |
|---|---|
| `tubcal` | start the server if it isn't running, and open it in your browser |
| `tubcal start` · `stop` · `restart` | the server, in the background |
| `tubcal status` | on air or not, the URL, and the Python / yt-dlp / Node versions |
| `tubcal logs` | follow the server log (journald, or `~/.local/state/tubcal/tubcal.log`) |
| `tubcal update` | `git pull`, re-sync, rebuild and restart, with your saved choices |
| `tubcal autostart on\|off` | start at login, or don't |
| `tubcal uninstall` | remove the launcher, menu entry, service and the private tools |

Uninstalling keeps your checkout, your data, and any distro packages it added (it lists
those). For an install made through `curl`, `tubcal uninstall --purge` also deletes
the cloned app *and its data*.

### Where things go

| | |
|---|---|
| `~/.local/bin/tubcal` | the launcher |
| `~/.local/share/tubcal/` | the install record, the private yt-dlp / uv / Node, and (curl installs) `app/` |
| `~/.local/share/applications/tubcal.desktop` | the app-menu entry |
| `~/.config/systemd/user/tubcal.service` | the user service, where there's systemd |
| `~/.local/state/tubcal/` | the server log and the installer's logs |

<details>
<summary><b>By hand</b>, for development: you need <b>Python ≥ 3.12</b>, <b>Node</b>, and <b><code>yt-dlp</code> on your PATH</b></summary>
<br>

```bash
uv sync                                               # backend
cd frontend && npm install && npm run build && cd ..  # frontend
uv run python main.py                                 # → http://127.0.0.1:5000
```

</details>

<details>
<summary><b>Optional extras</b> — the heavier features, each one opt-in</summary>
<br>

```bash
uv sync --extra brain     # The Archive: faster-whisper + numpy (local transcription)
uv sync --extra editor    # The Composing Room: flask-sock (PTY terminal + LSP bridge)
```

The installer offers both as checkboxes (or `--with archive,editor`).

| Also nice to have | Unlocks |
|---|---|
| A running [Ollama](https://ollama.com) server | The Archive's answers and summaries, and the *written* (rather than "wire") Edition |
| `rg` (ripgrep) | Fast project grep in the editor — falls back to `os.walk` |
| `notify-send` | A desktop ping ~10 min before a subscribed stream goes live |
| A language server (`rust-analyzer`, `pyright`, …) | Completion and diagnostics in the editor |

Every one of these degrades quietly. Miss them all and the app still boots — the feature
just reports itself unavailable.

</details>

---

## 📡 Two channels

The set has two channels, chosen at `/` — a TV-style chooser (press `1` or `2`):

|  | Channel | What's on |
|:---:|---|---|
| **1** | **The Hub** | Today's paper, your videos, the wire, the archive and the workshop — a set of numbered rooms beside a console. |
| **2** | **The Anime** | All of AniList — the season, the week's schedule, your list and its ledger, the community — as a section of its own. |

From anywhere, <kbd>Space</kbd> <kbd>g</kbd> <kbd>h</kbd> goes to the Hub and <kbd>Space</kbd> <kbd>g</kbd> <kbd>a</kbd> to the Anime.

---

## 🗞 Channel 1 · The Hub

There's no masthead. A slim **console** runs down the left — the wordmark, the channel
switch, a search-everything button, your rooms as numbered preset keys, and Saved /
Settings / skin — so every room starts at the top of the screen. The room you're in opens
its own index under it (the Screening Room lists its views, your channels with their new
counts, and what's queued). It folds to an icon rail, and becomes a top bar on a phone.

The numbers aren't hardcoded — they're each room's position in your own running order, so
switching one off in **Settings → Rooms** renumbers the rest. The default set:

| | Room | What it is |
|---:|---|---|
| **01** | **The Edition** | A daily front page composed on this machine. The same story found across YouTube, Reddit and HN is clustered into one article and ranked by editorial salience; with Ollama running it's written up as grounded, citation-checked prose, and without any AI it still prints a headlines-only "wire" edition. Nameplate with back issues, a lede with its picture and a rail beside it, ruled columns, In Brief grouped by room — and each story ticked off once you've opened it. Built once a day in the background; opening the page is a single SQLite read. |
| **02** | **Screening Room** | Your YouTube, without YouTube. The newest upload on a big screen beside what just came in and what's live; pick-up-where-you-left-off; **The Projection**, recommendations built only from your own watch history; a shelf per channel, busiest first. A *Latest* view of every upload by day, "new" badges per channel until you've watched or looked, an up-next queue, channel and playlist pages, and a day-by-day history. |
| **03** | **The Dispatch** | Reddit as an editorial broadsheet — serif headlines, per-subreddit pages, full-text search, threaded comments. |
| **04** | **The Wire** | Hacker News on a teletype board: Top, Best, New, Ask, Show and Jobs, and a search of the whole archive (newest-first, past day/week/month/year). Each line has a heat gauge and says how many comments arrived since you last read the thread; open one and the discussion sits beside the board — OP marked, branches foldable, new comments walked through. |
| **05** | **The Archive** | A second brain over the videos you actually watched. A background worker transcribes them with Whisper, chunks and embeds the transcripts into SQLite, and answers questions with cosine search plus a local LLM — reading a little around each excerpt before it answers. Fully offline. |
| **06** | **The Composing Room** | A real code editor: CodeMirror 6 with modal vim, file tree, tabs and splits, go-to-file, project grep, git gutter and branch, a which-key leader menu, session restore, an integrated PTY terminal and an optional LSP bridge. Sandboxed to one root directory. |
| **07** | **The Workbench** | One programming language per "service manual" — Rust, Python, Go, TypeScript. Curated facts and docs, talks, a podcast rail that plays in the page's own bench radio, core-team blog updates, trending repos, and a best-effort "current stable" stamp. |
| **—** | **GitHub** | Follow repositories and read releases and activity as a room. *Off by default* — switch it on in Settings → Rooms. |

---

## 🎞 The player

Every video — from any room — plays in one global player, straight from YouTube's own
streams: real 1080p, no account, no embed, no third party.

- **A theatre, not a pop-up.** The room goes dark, the picture's colours glow softly
  around it, and it's sized to the largest 16:9 that fits. Underneath: the title, the
  channel's face and subscriber count, Subscribe, Save, and a link that starts at this
  very second.
- **A seek bar that knows the video** — YouTube's *most replayed* as a ridge above it, cut
  at every chapter, with the chapter's name on hover and beside the clock.
- **Programme notes beside it.** The description with every timestamp seeking, every
  link to another video opening in the player and every hashtag searching the room;
  chapters; comments with faces, creator / verified / member / pinned / hearted marks,
  replies in place, Top or Newest, loading as you scroll; and The Archive's transcript
  (it follows the playhead) and summary.
- **Keeps playing when you leave.** <kbd>Esc</kbd> tucks it into a corner dock that
  stacks and reorders; an up-next queue rolls into the next video when one ends.

---

## 🌸 Channel 2 · The Anime

A whole section built on AniList — its own top bar, and a **file-tree index** down the left
where every view (and every useful place inside one) is one click away.

| | |
|---|---|
| **Browse** | Trending, popular, top-rated and more, plus a genre/tag finder with every AniList filter — infinite scroll. |
| **Seasons · Schedule** | Any season's line-up; the week ahead as an airing grid with countdowns. |
| **My List** | Your shelves with fast editing, bulk tools, custom lists, export (JSON, CSV, MyAnimeList XML) and the sequel radar — what comes next after everything you've finished. Synced to AniList as you tap. |
| **Ledger** | Your statistics computed from the list itself: genres, formats, scores, time spent, hot takes. |
| **Community** | Reviews, people's recommendation pairings (vote on them), today's birthdays and the hall of fame. |
| **Social** | The forum (threads beside the list), the activity stream, your inbox and people — profile pages, follow, message — with a live preview of every post as others will see it. |
| **Title pages** | The full dossier: cast with every dub's voice actors, characters, staff, studios, rankings, trends, a franchise watch-order guide, reviews and discussion. |

**Watching** happens in-app through two independent scrapers (two unrelated sites rarely
break on the same day), and finishing an episode advances your AniList progress on its
own. **The Reckoner** sits in the margin: hover any title, tap <kbd>C</kbd>, and it tallies
how long the next episodes take — and when you'd finish if you started now.

When you finish a season, **the curtain call** comes up: velvet drapes part on the title,
and in one place you can score it (in your own AniList scale), join the finale's episode
discussion, write the review while it's fresh, and put the next sequels on Planning or
Watching — or read *終*, series finished.

---

## 🎨 The look

Seven skins, each a `[data-theme]` block overriding design tokens — so every component
restyles for free, down to the editor buffer and the terminal's ANSI palette. Cycle them
from the console.

| | | |
|---|---|---|
| **Shōwa Night** — warm wood cabinet, amber tube | **Shōwa Day** — same set, tatami daylight | **Phosphor Terminal** — green text on a black tube |
| **Aqua Y2K** — a glossy turn-of-the-century desktop | **Bauhaus Print** — a constructivist poster | **Blueprint** — cyan hairlines on drafting navy |
| **Deep Space** — glass panels adrift over a nebula | | |

Your choice is injected server-side into `index.html`, so there's no flash of the wrong
theme on first paint.

---

## ⌨ Keyboard

| Keys | |
|---|---|
| <kbd>Space</kbd> <kbd>g</kbd> <kbd>h</kbd> · <kbd>Space</kbd> <kbd>g</kbd> <kbd>a</kbd> | The Hub · the Anime, from anywhere |
| <kbd>g</kbd> + letter | Jump between rooms — `ge` Edition · `gy` Screening Room · `gr` Dispatch · `gn` Wire · `gc` Composing Room · `gs` Saved · `gh` home |
| <kbd>h</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>l</kbd> | Move a roving focus across tiles by geometry — shelves and walls alike |
| <kbd>g</kbd> <kbd>g</kbd> · <kbd>G</kbd> | First · last tile on the page |
| <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>K</kbd> | Command palette — every room, and search across YouTube, Reddit and HN |
| <kbd>C</kbd> | Tally the next episode in The Reckoner (anime) |

<details>
<summary><b>In the player</b></summary>
<br>

| Keys | |
|---|---|
| <kbd>Space</kbd> / <kbd>K</kbd> | Play · pause |
| <kbd>J</kbd> <kbd>L</kbd> · <kbd>←</kbd> <kbd>→</kbd> | Back / forward 10s · 5s |
| <kbd>Ctrl</kbd> <kbd>←</kbd> <kbd>→</kbd> | Previous · next chapter |
| <kbd>0</kbd>–<kbd>9</kbd> | Jump to 0–90% |
| <kbd>↑</kbd> <kbd>↓</kbd> · <kbd>M</kbd> | Volume · mute |
| <kbd>&lt;</kbd> <kbd>&gt;</kbd> | Slower · faster |
| <kbd>F</kbd> · <kbd>C</kbd> | Fullscreen · captions |
| <kbd>Shift</kbd> <kbd>N</kbd> | Next in Up next |
| <kbd>Esc</kbd> | Keep playing in the corner |
| <kbd>?</kbd> | This list, on screen |

</details>

The global bindings stand down while you're typing, while a video is on the big screen,
and while the Composing Room has focus — those own their own keys.

---

## 🔒 Privacy

Binds to `127.0.0.1` and nothing else. Self-hosted fonts, no trackers, no analytics.
Every YouTube read is anonymous — no cookies stored or sent, so there's no stable id
linking your searches, feeds and playback. Subscriptions, settings, watch history,
playback progress, saved items, OAuth tokens and every byte of Archive data live in one
git-ignored SQLite file, `data/tubcal.db`.

---

## ⚙ Configuration

Nothing is required. Copy `.env.example` to `.env` only to override a default; anything
you'd want to change while the app is running lives in **Settings** instead.

| Variable | Default | Purpose |
|---|---|---|
| `TUBCAL_PORT` | `5000` | Port to bind on `127.0.0.1`. |
| `TUBCAL_OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint for The Archive and The Edition. |
| `TUBCAL_BRAIN_ASK_EXPAND` | `3` | How many excerpts The Archive reads more closely before answering (`0` turns that off). |
| `TUBCAL_INVIDIOUS` | *(auto)* | Comma-separated Invidious instances (trending, comments, search fallback). |
| `TUBCAL_EDITOR_ROOT` | `~/Projects` | The only directory the Composing Room can reach. |
| `TUBCAL_EDITOR_MAX_FILE_BYTES` | `4194304` | Refuse to open files larger than this. |
| `TUBCAL_GITHUB_TOKEN` | *(none)* | A classic PAT — lifts GitHub's 60 req/hr/IP ceiling to 5000. Can be pasted into Settings instead. |
| `TUBCAL_ANIME_PROVIDER` | *(auto)* | Prefer one anime scraper: `allanime` or `animekai`. |
| `TUBCAL_ANIME_WATCHED_PERCENT` | `80` | Auto-mark an episode watched on AniList past this %. `0` disables. |
| `TUBCAL_AUTO_UPDATE` | `1` | Set `0` to stop upgrading `anipy-api` from PyPI on startup. |

### Connecting accounts (all optional)

Everything works logged out. **Settings → Connections** shows the redirect URIs to
register if you want more:

- **Reddit** — logged out, Reddit only serves RSS (it blocks anonymous JSON), so you get
  no scores and flattened comments. An OAuth *web app* (reddit.com/prefs/apps) upgrades
  everything to full data.
- **YouTube / Google** — an OAuth *Web application* client with the YouTube Data API v3
  enabled pulls in your real subscriptions.
- **AniList** — required for the Anime channel: AniList now refuses unauthenticated
  queries, and your list, progress sync and the social side all need it.
- **GitHub** — no OAuth flow; paste a classic PAT into Settings.

---

## 🛠 How it works

> **Caching is the load-bearing wall.** Two layers — an in-memory dict over a `cache`
> table in SQLite — so caches survive restarts. Expired rows are kept *on purpose*: if an
> upstream fetch fails, the stale payload is served instead of an error. That single
> decision is why Reddit's rate limiting can't take the app down.

**YouTube quality, without an account or ffmpeg.** YouTube's open player clients now
expose exactly one muxed rendition — 360p. Everything above ships as adaptive DASH, video
and audio apart. Tubcal keeps 360p as an instant floor and, for each higher rendition,
parses the stream's `sidx` index into byte-range segments and synthesizes an HLS playlist
around them; `hls.js` muxes the two in the browser, fetching straight from googlevideo
through a segment proxy. Real 1080p with native seeking, no transcoding.

**Search goes to the source.** YouTube search talks to YouTube's own InnerTube endpoint —
one unauthenticated request, sub-second — with Invidious kept only as a fallback. Hacker
News search is Algolia.

**AniList on a budget.** AniList currently allows 30 requests a minute. Every read is
cached, relation walks (sequels, watch order) are cached per title, the fan-out walkers
check the remaining budget and stop early, and list edits apply locally at once and sync
on a short debounce — a flurry of taps is one mutation.

**The Edition never computes on the request path.** A background thread builds one JSON
payload per day. Model synthesis is capped at six calls per build, time-boxed, and gated
by a citation validator with a template fallback — unvalidated model output can't reach
a page, so the paper cannot invent a story.

**Untrusted HTML is never injected.** Comments and descriptions from YouTube, HN and
AniList are walked with an allow-list into React elements — which is also what lets a
timestamp seek, or a link to another video open in the player.

**The editor is sandboxed.** Every client-supplied path resolves against `EDITOR_ROOT` and
is rejected if it escapes — traversal, absolute paths, symlinks out. Writes are atomic
(temp file + `os.replace`) behind an mtime precondition, so a stale buffer gets a conflict
instead of clobbering your file; `:w!` forces.

**Heavy dependencies are lazy.** anipy, numpy, faster-whisper, rapidfuzz and flask-sock are
imported inside the function that needs them and guarded — which is what lets minimal
runtimes (down to the Android/Chaquopy build) boot at all.

---

## 🗂 Layout

```
main.py                   updater → init DB → create_app → warm caches → start workers → run
server/
  config.py               env-driven config, cache TTLs, room ids
  db.py                   the one SQLite file: subs, settings, history, tokens, archive, editions
  cache.py                TTL + stale-while-revalidate cache, persisted
  httpc.py                shared sessions, per-host spacing, anonymous (cookie-less) reads
  updater.py              self-update anipy-api before anything imports it
  notifier.py             desktop ping before a subscribed stream goes live
  api/                    blueprints — every response wrapped ok(data) / err(msg)
  sources/                one module per platform's quirks (+ innertube, fmp4, mixer, fuzzy)
  brain/                  The Archive (transcribe · search · summarize · llm · worker)
                          and The Edition (cluster · feed_index · edition)
  editor/                 PTY terminal + stdio JSON-RPC ⇄ WebSocket LSP bridge
frontend/src/
  lib/rooms.js            canonical room registry — the source of the numbering
  lib/themes.js           the skin registry
  lib/urlState.js         view state lives in the URL, so Back restores it
  pages/                  one lazy-loaded page per room (+ the chooser, the anime pages)
  components/layout/      the hub console, command palette, keyboard nav
  components/player/      the global player, its controls and programme notes
  components/screening/   video tiles, shelves, the Screening Room's index
  components/wire/        the HN reader
  components/anime/       every view of the Anime channel
  state.jsx               shared state as a stack of context providers
  styles/                 design tokens + one block per skin
android/                  the phone app: Gradle project, phone UI (phone/), vendored scrapers
install.sh                the Linux installer (any distro; Fedora Asahi included)
packaging/linux/          what it installs: the `tubcal` launcher, menu entry, user service
data/tubcal.db            everything local (git-ignored)
```

**Adding a room** is three edits kept in sync: an entry in `lib/rooms.js`, a component in
`pages/`, a route in `App.jsx`.

## 🧪 Develop

```bash
uv run python main.py        # API on :5000
cd frontend && npm run dev   # UI on :5173, /api proxied

uv run pytest                # backend tests
```

Two servers in dev; in production mode Flask serves `frontend/dist` on one port — so a UI
change there needs `npm run build` and a hard refresh, and a backend change needs a
restart. The deepest test coverage sits where a bug would be silent: edition clustering,
editor path containment, the fMP4 index parser, anonymous YouTube reads, and the pure
AniList helpers.

## 📱 On a phone

`android/` builds the same Tubcal as an Android app. It runs the whole stack on the
phone: the Flask backend runs inside the APK and a phone-made UI sits on top. It
builds from the desktop code in this repo, nothing is copied. See
[android/README.md](android/README.md). The desktop app doesn't need it, and
ignores it.

## License

Copyright (C) 2026 shio-t0

Tubcal is free software: you can redistribute it and/or modify it under the terms of
the GNU General Public License as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version.

Tubcal is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
PURPOSE. See the GNU General Public License for more details. A copy is in
[LICENSE](LICENSE); Settings → About shows it in the app too.

Anime playback builds on other GPL-3.0 projects: ani-cli's method, anipy-api and
weeb-cli. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) credits them. A build
also lists every library bundled into the web app in `legal/third-party-licenses.txt`.

---

<div align="center">

*Runs on localhost, for one person, on purpose.*

</div>
