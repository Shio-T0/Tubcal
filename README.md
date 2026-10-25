<div align="center">

# Tubcal<sub>.</sub>

### YouTube, Reddit, Hacker News, GitHub and anime in one app on your own computer.

Three channels: **Social** (a daily paper, Hacker News, Reddit), **Coding** (a code
editor, programming-language news, GitHub) and **Video** (YouTube, anime, and a
searchable archive of what you've watched).<br>
One Flask app, bound to `127.0.0.1`.

![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-3b2a1a?style=flat-square&logo=python&logoColor=e6ab5e)
![React 19](https://img.shields.io/badge/react-19-3b2a1a?style=flat-square&logo=react&logoColor=e6ab5e)
![Flask](https://img.shields.io/badge/flask-backend-3b2a1a?style=flat-square&logo=flask&logoColor=e6ab5e)
![SQLite](https://img.shields.io/badge/sqlite-one%20file-3b2a1a?style=flat-square&logo=sqlite&logoColor=e6ab5e)
![Localhost only](https://img.shields.io/badge/binds-127.0.0.1%20only-3b2a1a?style=flat-square)
![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-3b2a1a?style=flat-square)

*You don't need an account except for the anime part (AniList). There's no cloud and no
telemetry: Tubcal only connects to the sites you use through it.*

**[The tour and the manual](https://shio-t0.github.io/Tubcal/)** ·
[Quick start](#-quick-start) ·
[Installation](#-installation) ·
[Three channels](#-three-channels) ·
[Saving](#-saving) ·
[The player](#-the-player) ·
[The Anime](#-the-anime) ·
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

It opens on a test card that reads your system, lets you pick the rooms you want and
a few options, and shows its running order (including the exact distro command, if
one is needed) before anything runs. Then:

1. **Distro packages:** only what's missing, with sudo asked for once and used for
   nothing else.
2. **Tubcal itself, with only the rooms you picked.** A curl install makes a partial
   clone and checks out just those rooms' files, so a room you leave out is never
   downloaded. Run from your own git checkout, it leaves the other rooms' files out of
   that checkout (files you've changed stay).
3. **uv, Node.js and Python 3.13:** the distro's own when it has recent enough ones.
   Otherwise a private uv, a checksum-verified Node 24 LTS and a uv-managed Python,
   all under your home.
4. **The backend and the frontend:** `uv sync` with the Python packages your rooms
   use, then a production build of the frontend with only their pages.
5. **A private yt-dlp,** if you picked the Screening Room: Tubcal's own copy, refreshed
   at most once a day, set up to solve YouTube's JS challenges with Node. Your own
   yt-dlp, if you have one, is untouched.
6. **The `tubcal` command, an app-menu entry, and a user service** (systemd, where
   there is one).
7. **A self-test:** the app is booted against a throwaway database and has to serve
   the page, answer its API, and have the rooms you picked.

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

### Rooms

Every room is optional, and so is By topic, a page of the Wire's. A room you leave out
has no files, Python packages or pages on your machine, and Tubcal's channels, home screen and settings show only the rooms you
have. A channel with none of its rooms installed isn't shown.

| Room | Name | What it adds |
|---|---|---|
| The Edition | `edition` | the daily paper; numpy, about 20 MB |
| The Wire | `hackernews` (or `wire`) | Hacker News |
| By topic | `topics` (or `bytopic`, `sorter`) | not a room but a page of the Wire's: its front page sorted into five topics by Ollama, shown in the Social bar with 3D objects on; needs the Wire |
| The Dispatch | `reddit` (or `dispatch`) | Reddit |
| The Composing Room | `editor` | the code editor, with flask-sock for its terminal and language servers |
| The Workbench | `dev` (or `workbench`) | the programming-language manuals |
| GitHub | `github` | the GitHub room *(off by default in a curl install)* |
| The Screening Room | `youtube` (or `screening`) | YouTube, and the private yt-dlp, about 60 MB |
| The Anime | `anime` | the Anime and its scrapers, about 100 MB |
| The Archive | `archive` | faster-whisper transcription, about 300 MB; needs the Screening Room *(off by default)* |

Some rooms use others when they're there: the Edition reads the Wire, the Dispatch and
the Screening Room; the Workbench's talks need the Screening Room and its trending repos
need GitHub. Without them those parts don't appear.

### Options

| Option | Flag | What it is |
|---|---|---|
| App-menu entry & icon | `desktop` | launch Tubcal like any other app *(on)* |
| Start when I log in | `autostart` | a systemd user service, or XDG autostart *(off)* |
| Distro extras | `extras` | `notify-send` for live-stream pings (Screening Room) and `ripgrep` for the editor's search (Composing Room) *(on when there's root)* |
| 3D objects | `3d` | the home screen as a box you turn, with the TV on the front and a channel on each other side, and By topic in the Social channel (Hacker News sorted into five topics by the local AI); Settings → Appearance changes it later *(off)* |

```bash
./install.sh --yes                                # no questions: defaults, or your last choices
./install.sh --rooms wire,dispatch,anime          # exactly these rooms
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
| `tubcal rooms` | every room, and which ones are installed |
| `tubcal add ROOM…` | add rooms you left out: downloads their files and packages, rebuilds, restarts |
| `tubcal remove ROOM…` | take rooms out again; what you saved, followed and watched stays in your database |
| `tubcal phone` | put Tubcal for Android on a phone plugged in over USB, or update it, with the rooms you pick for it ([On a phone](#-on-a-phone)) |
| `tubcal phone rooms` · `add ROOM…` · `remove ROOM…` | the same as `rooms`, `add` and `remove`, for the phone |
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

The installer installs each with its room (`--with archive,editor`, or `tubcal add`
later). A plain `uv sync` also installs the Anime's scrapers (the `anime` dependency
group); `--no-group anime` leaves them out.

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

## 📡 Three channels

Tubcal opens on a home screen that shows what to pick up next: the video or episode you
left halfway, new uploads, who's live, what airs soon and today's paper. From there you
go into one of three channels. Each channel holds a few numbered rooms and has a layout
of its own.

| | Channel | Rooms | Layout |
|:---:|---|---|---|
| **1** | **Social** | The Edition · The Wire · The Dispatch | a newspaper-style section bar across the top |
| **2** | **Coding** | The Composing Room · The Workbench · GitHub | an editor-style activity bar down the left, and a title bar with the path you're on |
| **3** | **Video** | The Screening Room · The Anime · The Archive | a wooden console down the left; the room you're in lists its own places under its key |

Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> on the home screen, or <kbd>Space</kbd>
<kbd>g</kbd> then <kbd>s</kbd> / <kbd>c</kbd> / <kbd>v</kbd> from anywhere. Room numbers
are each room's position inside its channel, so switching one off in **Settings → Rooms**
renumbers the rest. A room you didn't install isn't shown at all.

### Social

| | Room | What it is |
|---:|---|---|
| **01** | **The Edition** | A front page made each morning from your channels, subreddits and Hacker News. Posts about the same story are grouped into one; with Ollama running, the top stories are written up as short articles that cite their sources, and without it you get the headlines. It's built in the background once a day, keeps back issues, and ticks stories off as you read them. |
| **02** | **The Wire** | Hacker News: Top, Best, New, Ask, Show and Jobs, and a search of the whole archive. Each line shows how fast the story is gaining points and how many comments are new since you last looked. Open one and the discussion sits beside the list, with branches you can fold. |
| **03** | **The Dispatch** | Your subreddits laid out like a newspaper, with search and comments. Signing in to Reddit adds scores and threaded comments. |

### Coding

| | Room | What it is |
|---:|---|---|
| **01** | **The Composing Room** | A code editor: CodeMirror 6 with vim keys, a file tree, tabs and splits, go-to-file, project search, git status, a leader-key menu, a terminal and optional language servers. It can only open files inside one folder (`~/Projects` unless you set another). |
| **02** | **The Workbench** | A page each for Rust, Python, Go and TypeScript: talks, podcasts that play on the page, posts from each language's core team, trending projects and the current stable version. |
| **03** | **GitHub** | The projects and people you follow, drawn as a commit graph of commits, releases, issues and pull requests. Read a project's files, issues and pull requests here, see what's trending, and clone a project into your workspace to open it in the editor. Link your account (the GitHub CLI's sign-in or a token) for your notifications, your open work and your stars. *Off by default.* |

### Video

| | Room | What it is |
|---:|---|---|
| **01** | **The Screening Room** | The YouTube channels you follow, without ads or an account. The newest upload on a big screen beside what just came in and what's live; the videos you didn't finish; **The Projection**, suggestions based only on what you've watched in Tubcal; a shelf per channel; every upload by day; an up-next queue; channel, playlist and history pages. |
| **02** | **The Anime** | Your AniList, with episodes to watch. See [The Anime](#-the-anime). |
| **03** | **The Archive** | Transcribes the videos you choose on your own computer with Whisper, so you can search what was said. With Ollama it also summarises them and answers questions, linking each answer to the moments it came from. *Not installed by default.* |

---

## 🔖 Saving

Nearly everything has a bookmark: videos, playlists and channels, Reddit posts and
subreddits, Hacker News stories, anime titles, characters, voice actors, studios and
threads, GitHub projects and releases, Workbench talks, podcasts and posts, moments in
the Archive, and files in the editor (<kbd>Space</kbd> <kbd>b</kbd>). The drawer's
**Save page** keeps any other page.

Everything lands in one place. **Saved** and **Settings** open in a drawer at the side of
any page (<kbd>Space</kbd> <kbd>s</kbd>, <kbd>Space</kbd> <kbd>,</kbd>), so you don't
lose your place. The Saved page sorts what you've kept by channel and kind, splits it into
To do and Done, and lets you add notes, search titles and notes, switch between shelves
and a list, and clear many things at once.

---

## 🎞 The player

Every video, from any room, plays in one player, straight from YouTube's own streams at
up to 1080p, with no account and no embed.

- The page dims and the video plays as large as fits. Under it are the title, the
  channel with its subscriber count, Subscribe, Save, and a button that copies a link
  to the current second.
- The seek bar is split at the chapters, and a line above it shows where people
  replay most.
- Beside the video: the description (timestamps seek, links to other videos open in
  the player), chapters, comments, and, from the Archive, the transcript and a summary.
- <kbd>Esc</kbd> moves the video to a corner, where it keeps playing while you browse.
  An up-next queue plays videos one after another.
- Tubcal draws subtitles itself, so their font, size, colour and position are yours to
  set, in every player.

---

## 🌸 The Anime

The Anime is a room in the Video channel, built on AniList. While you're in it, its views
are listed under its key in the console, with your AniList account at the top.

| | |
|---|---|
| **Browse** | Trending, popular, top-rated and this season, plus a finder that filters by any mix of genres and tags. More loads as you scroll. |
| **Seasons · Schedule** | Any season's shows; the week ahead as a timetable with countdowns. |
| **My List** | Your shelves, saved to AniList as you change them, with bulk editing, custom lists, export (JSON, CSV, MyAnimeList XML) and the sequel radar, which finds what comes after the shows you've finished. |
| **Ledger** | Statistics worked out from your list: genres, formats, scores, time spent, the shows you rate unlike everyone else. |
| **Community** | Reviews, recommendations (vote on them), today's birthdays and the hall of fame. |
| **Social** | The forum, the activity stream, your inbox and people's profiles, with a live preview of every post as others will see it. |
| **Title pages** | Cast with every dub's voice actors, staff, studios, rankings, trends, a watch-order guide for long series, reviews and discussion. |

Episodes play in Tubcal's own player, from public anime sites (two independent ones, so
one breaking doesn't stop playback), and finishing one moves your AniList progress on.
**The Reckoner** sits in the page margin: point at a show, press <kbd>C</kbd>, and it adds
up how long its next episodes take and when you'd finish if you started now. When you
finish a season, **the curtain call** lets you score it, join the last episode's
discussion, write a review and put the sequel on your list.

---

## 🎨 The look

Eight skins, each a `[data-theme]` block that overrides design tokens, so every component
restyles with it, down to the editor and the terminal's colours. Change it with the skin
button in any channel's bar, or in Settings.

| | | |
|---|---|---|
| **Shōwa Night**: dark wood and amber, like an old TV set (the default) | **Shōwa Day**: the same set in light colours | **Phosphor Terminal**: green text on black |
| **Aqua Y2K**: glossy blue and white, like a 2000s desktop | **Bauhaus Print**: red, blue and black on off-white | **Blueprint**: pale blue lines on navy |
| **Deep Space**: see-through panels over a dark purple nebula | **Cutting Mat**: dark windows on a teal cutting mat (desktop only) | |

The chosen skin is written into `index.html` by the server, so the first paint already
has the right colours. **Fast mode** (Settings → Appearance) turns off every animation.

---

## ⌨ Keyboard

| Keys | |
|---|---|
| <kbd>Space</kbd> <kbd>g</kbd> <kbd>s</kbd> · <kbd>c</kbd> · <kbd>v</kbd> | Social · Coding · Video, from anywhere |
| <kbd>Space</kbd> <kbd>g</kbd> <kbd>a</kbd> · <kbd>h</kbd> | The Anime · the home screen |
| <kbd>Space</kbd> <kbd>s</kbd> · <kbd>Space</kbd> <kbd>,</kbd> | The Saved drawer · the Settings drawer |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | The channels, on the home screen |
| <kbd>g</kbd> + letter | Jump to a room: `ge` Edition · `gn` Wire · `gr` Dispatch · `gc` Composing Room · `gd` Workbench · `gy` Screening Room · `ga` Anime · `gs` Saved · `gh` home |
| <kbd>h</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>l</kbd> | Move between tiles by where they are on screen |
| <kbd>g</kbd> <kbd>g</kbd> · <kbd>G</kbd> | First · last tile on the page |
| <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>K</kbd> | Command palette: every room, a search across YouTube, Reddit and HN, and your saved things |
| <kbd>C</kbd> | Add the next episode to the Reckoner (anime) |

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

The global keys stand down while you're typing, while a video is on the big screen, and
while the Composing Room has focus; those have their own keys. After <kbd>Space</kbd>, a
small menu shows what the next key does.

---

## 🔒 Privacy

Binds to `127.0.0.1` and nothing else. Self-hosted fonts, no trackers, no analytics.
Every YouTube read is anonymous — no cookies stored or sent, so there's no stable id
linking your searches, feeds and playback. Subscriptions, settings, watch history,
playback progress, saved things and their notes, OAuth tokens and all of the Archive's
data live in one git-ignored SQLite file, `data/tubcal.db`.

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
| `TUBCAL_GITHUB_TOKEN` | *(none)* | A GitHub token, for setups that can't use Settings → Accounts (which takes the GitHub CLI's sign-in or a pasted token). Raises GitHub's limit from 60 requests an hour to 5,000. |
| `TUBCAL_ANIME_PROVIDER` | *(auto)* | Which anipy-api provider to try first (`allanime` or `animekai`) when hianime can't play an episode. |
| `TUBCAL_ANIME_WATCHED_PERCENT` | `80` | Auto-mark an episode watched on AniList past this %. `0` disables. |
| `TUBCAL_AUTO_UPDATE` | `1` | Set `0` to stop upgrading `anipy-api` from PyPI on startup. |

### Connecting accounts (all optional)

Everything but the Anime works without signing in. **Settings → Accounts** shows the
redirect URIs to register if you want more:

- **Reddit** — logged out, Reddit only serves RSS (it blocks anonymous JSON), so you get
  no scores and flattened comments. An OAuth *web app* (reddit.com/prefs/apps) upgrades
  everything to full data.
- **YouTube / Google** — an OAuth *Web application* client with the YouTube Data API v3
  enabled pulls in your real subscriptions.
- **AniList** — needed for the Anime: AniList now refuses unauthenticated queries, and
  your list, progress sync and the social side all need it.
- **GitHub** — no OAuth app to register. If the GitHub CLI is signed in, one press takes
  its token; otherwise paste a classic token (`repo`, `notifications`, `user:follow`).
  The token is checked against GitHub, kept in the database and never sent to the page.

---

## 🛠 How it works

> **Most of it rests on the cache.** It has two layers, an in-memory dict over a `cache`
> table in SQLite, so it survives restarts. Expired rows are kept: if an upstream fetch
> fails, the stale payload is served instead of an error. That's what keeps Reddit's rate
> limiting from breaking the app.

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
by a citation validator with a template fallback, so model output that doesn't cite its
sources never reaches the page; the story is printed as a plain headline instead.

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
  modules.py              which rooms this copy has (modules.ini, TUBCAL_MODULES)
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
  lib/modules.js          which rooms this build has; lazy imports for a room's parts
  lib/themes.js           the skin registry
  lib/urlState.js         view state lives in the URL, so Back restores it
  lib/saveable.js         what each saved thing is (kind, channel), for anything that isn't a feed item
  pages/                  one lazy-loaded page per room (+ home, Saved, Settings, the anime pages)
  components/home/        the home screen: the TV, the coming-up slip, the channel guides
  components/channels/    the three channel frames, and the Saved/Settings frame
  components/pocket/      the Saved & Settings drawer
  components/layout/      command palette, keyboard nav
  components/player/      the global player, its controls and programme notes
  components/screening/   video tiles, shelves, the Screening Room's index
  components/wire/        the HN reader
  components/anime/       every view of the Anime
  state.jsx               shared state as a stack of context providers
  styles/                 design tokens + one block per skin
android/                  the phone app: Gradle project, phone UI (phone/), vendored scrapers
modules.ini               the rooms an install can leave out, and the files each owns
install.sh                the Linux installer (any distro; Fedora Asahi included)
packaging/linux/          what it installs: the `tubcal` launcher, menu entry, user service
data/tubcal.db            everything local (git-ignored)
```

**Adding a room** is a few edits kept in sync: an entry in `lib/rooms.js`, a component in
`pages/`, a route in `App.jsx`, its blueprint in `server/api/__init__.py`, and a section
in `modules.ini` (copied into `install.sh`) listing the files it owns.
`tests/test_modules.py` checks that they agree and that nothing outside the room imports
its files directly.

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

To put it on your phone, turn on USB debugging (Settings → About phone: tap Build
number seven times, then Settings → System → Developer options → USB debugging),
plug the phone in and run:

```bash
tubcal phone
```

It finds the phone (and waits while you tap Allow on its "Allow USB debugging?"
question) and asks which rooms the phone gets. Then it streams the latest release
from GitHub straight to the phone over adb: the core app plus the APKs of the
chosen rooms, each checked against its SHA-256. Nothing is saved on your computer.
It installs Tubcal, or updates the copy already there. Without adb it offers your distro's package. If a phone is plugged in while
`install.sh` runs, the installer asks whether to do the same, with the rooms you
just picked. `tubcal phone --apk DIR` installs a build of your own instead (the folder
`android/tools/release.sh --dry-run` writes). The app
keeps its own data; `android/tools/sync-data.sh` copies yours across.

The phone's rooms work like the computer's: the same menu, and a room comes with
the rooms it needs. The phone app has every room except the Composing Room and By
topic. `tubcal phone rooms` lists what the phone has, and `tubcal phone add anime`
or `tubcal phone remove reddit` changes it (`--rooms`, `--with` and `--without`
work too). Each room is an APK of its own, so a room you leave out isn't on the
phone at all, and adding or removing one installs or uninstalls only that room.
An update brings the rooms the phone has.

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
