# Tubcal for Android (native, fully local)

The **entire Tubcal stack, on the phone**, with a UI made for a phone. The Flask
backend runs as CPython inside the APK ([Chaquopy](https://chaquo.com/chaquopy/))
on `127.0.0.1`, and a full-screen `WebView` shows **Tubcal Phone**: a separate UI
built for one hand. It is not the desktop page squeezed down. No PWA, no PC, no
remote server.

This is the `android/` folder of the Tubcal repo. It holds only the phone parts.
The build takes the desktop's `server/` and `frontend/src/` straight from the repo
root, so the APK always runs the code beside it, with nothing copied or synced.

## The phone UI (`phone/`)

The same rooms and the same data as the desktop, redrawn for a phone:

- **Five tabs at the bottom**: Today, Watch, Anime, Read and More. Each tab
  remembers where you were inside it. Tapping the tab you're on returns to its
  top. Badges show new uploads and unread AniList mail.
- **Today**: The Edition as a one-column front page:
  - The lead story full-bleed, the front-page stories as cards, and In Brief
    filtered by room.
  - Back issues in a sheet, page-turns at the foot, and per-paper read ticks.
- **Watch**: your channels' faces in a strip (a dot means something new), with
  For you / Latest / Live / History views.
  - Channel pages: Subscribe, Play all, search inside the channel, and playlists.
  - Playlist pages with Play all and Shuffle.
  - History with swipe-to-forget.
- **The player**: one video at a time, with a watch page and a mini player above
  the tabs.
  - Gestures: double-tap either side to seek (taps add up), hold for 2×, and
    swipe the picture down to tuck it away.
  - Fullscreen rotates to landscape and hides the system bars.
  - The watch page has About / Chapters / Comments / Transcript / Summary / Up
    next tabs, the "most replayed" ridge and chapter cuts on the scrubber, and a
    settings sheet for speed, quality and captions.
  - Anime episodes get their own player:
    - The show's colour, and a watch page with the show, the episode and its
      title, Sub/Dub, AniList status, previous/next and every episode.
    - "Skip opening" and "Next episode" cues from the source's timings, with
      Opening/Ending chapters on the seek strip.
    - An 8-second countdown into the next episode.
  - Subtitles are drawn in your own style (Settings → Subtitles, or the player's
    settings sheet). The style is saved and shared with the desktop:
    `tools/sync-data.sh` keeps whichever side changed it last.
- **Anime**: opens on what you're watching.
  - Each show is a row with ▶ (plays the next episode from the local source)
    and ＋1, how far behind you are, and when the next episode airs.
  - A "catch-up" line totals the time it would take and when you'd be done.
  - Shelves sit on chips. Long-press an entry for move / −1 / curtain call /
    select-for-bulk-edit.
  - Pick-for-me, sequel radar and export live in a sheet.
  - Browse is a three-across poster wall with a finder sheet: every genre and
    tag (tap to require, tap again to exclude) plus AniList's advanced filters.
  - The **title page** has:
    - One big button that resumes or plays the right episode.
    - Your list entry: shelf, a −/＋ stepper, and your score shown in your own
      format. Changing the score takes an "Edit score" tap; the options open in
      a sheet and nothing is saved until Save, so scrolling past can't move it.
      The rest is in a Details sheet.
    - The time left to catch up.
    - Tabs: Episodes (spoiler guard; long-press marks everything up to an
      episode watched), About, Cast (dub switch), Related (watch order,
      recommendation votes), Reviews and Talk.
  - Seasons, Schedule, Ledger, Community, Channel and Social are the desktop's
    own views, refitted.
- **Read**: The Wire, The Dispatch and GitHub, switched from the bar. Rooms
  you've turned off in Settings stay hidden.
  - Tap a story for the article and the comment pill for the discussion.
  - Discussions, Reddit posts and repos open as slide-in pages (swipe from the
    left edge or press Back).
- **More**: The Archive and The Workbench; Saved, history, the up-next queue,
  the skin picker and Settings. The Composing Room (the code editor) stays a
  desktop room and isn't in the phone app.
- **Everywhere**:
  - Bottom sheets replace menus and modals, and long-press any card for its
    actions.
  - Pull down to refresh.
  - Search covers everything from one box, with recent searches.
  - Android **Back** closes the top-most thing first (a sheet, the player, a
    search), then goes back a page, then leaves the app like Home.

**Motion.** Everything that can move does, and all of it stands down for
Android's "Remove animations" (`prefers-reduced-motion`):

- **Player:** the thumbnail you tap grows into the player, minimising folds the
  picture into the mini bar, and the mini bar grows back. These are View
  Transitions (`phone/src/lib/motion.js` → `morph`, `lib/play.js`).
- **Pages:** forward slides in from the right, Back from the left, and another
  tab fades up. Slide-in pages draw the page beneath back and dim it.
- **Arrival:** rows and cards rise into place as they scroll in, cascading when
  several arrive together. This runs on `data-reveal` and an IntersectionObserver.
  Pictures fade in as they load, and skeletons with a moving sheen stand in
  while lists load.
- **Touch:** everything pressable gives a little under your thumb. The tab bar's
  pill and the chosen chip's pill glide (and stretch) to the next one.
  Sheets and slide-in pages animate out, from wherever you let go.
- **Details:** episode counts tick, "+1" floats off the button, and stars light
  up in a wave. The lead story's picture slowly settles, and the anime banner
  scrolls more slowly than the page. A new skin washes over the screen in a
  circle from your finger.

The vocabulary lives in `phone/src/styles/motion.css`: curves `--e-out`,
`--e-in`, `--e-spring` and `--e-swift`, the reveal and skeleton styles, and the
View Transition choreography. One gotcha: a CSS module that names keyframes
defined outside it gets the reference renamed, so the animation silently never
runs. Define module keyframes in the module itself (or use the global `ph-*`
classes).

How it's built: `phone/` is a Vite + React app.

- The desktop's `frontend/src` (`../../frontend/src`) is imported in place as
  `@pc/…`. The phone reuses its state (`state.jsx`), API client, data hooks and
  the heavier screens. Every npm dependency resolves from `phone/node_modules`
  (`resolve.dedupe` in `vite.config.js`), so `frontend/` needn't be installed.
- The phone's own shell, player and screens live in `phone/src/{shell,player,screens}`.
- Desktop CSS-module classes are built with stable names (`pc_<dir>_<file>__<class>`,
  see `vite.config.js`), so `phone/src/styles/phone.css` can refit the reused
  desktop screens for a phone.
- The routes keep the desktop's URL scheme, so links inside reused screens land
  on the right phone screens.
- The build goes into `app/build/generated/phone-web/web/`, which Gradle packs as
  the APK's `assets/web` (it runs the build itself; see below).

## How it works

```
┌──────────────────────────────── APK ────────────────────────────────┐
│  MainActivity (Kotlin)                WebView → http://127.0.0.1:8137 │
│   ├─ window.TubcalAndroid  ◄──────── phone UI (assets/web, phone/)   │
│   │   share · open links · rotation · keep-awake · haptics ·         │
│   │   status-bar colour · immersive · save files                     │
│   ├─ insets → --sa-top/bottom/left/right · keyboard → html[data-kb]  │
│   └─ Back → window.tubcalBack() → history → Home                     │
│  TubcalService (foreground)                                          │
│   ├─ Chaquopy → android_main.start(dataDir, webDir, port)            │
│   │    ├─ ytdlp_shim.install()  (yt-dlp "binary" = bundled library)  │
│   │    ├─ server/ (Flask, unmodified) → 127.0.0.1:8137               │
│   │    └─ desktop_main jobs: cache warm-up, avatar backfill,         │
│   │       The Edition's daily build, The Archive worker              │
│   └─ live poller → /api/youtube/live → notification ~10 min before   │
│      a subscribed stream; tapping it opens Watch → Live              │
└──────────────────────────────────────────────────────────────────────┘
```

- **Backend**: the desktop's `server/` package, **unmodified**. Data lives in the
  app's private storage (`filesDir/data/tubcal.db`).
- **yt-dlp**: the desktop shells out to a `yt-dlp` binary. A phone has none, but
  the yt-dlp *library* is bundled.
  - `app/src/main/python/ytdlp_shim.py` gives `server/sources/youtube.py` a
    `shutil.which("yt-dlp")` that answers, and a `subprocess.run` that runs the
    library in-process.
  - The argv goes through yt-dlp's own option parser, and the JSON comes back on
    "stdout". So `youtube.py` syncs as-is.
  - Without a JavaScript runtime, YouTube still offers AVC renditions up to
    1080p, which the desktop's adaptive-HLS path plays.
- **`desktop_main.py`**: the desktop `main.py`, packed under that name by Gradle.
  `android_main` borrows its background-job helpers so the phone starts what the
  desktop starts.
  - Not started: the anipy self-updater (an APK can't pip-install) and the
    notify-send notifier (the Kotlin service posts native notifications instead).
- **Anime**: `anipy-api` is vendored (see below). weeb-cli's `aniworld` provider
  is the fallback, as on the desktop.
- **Saving files**: a WebView ignores `<a download>` for blob links (the list
  export, the schedule's `.ics`). The phone UI hands those bytes to the shell,
  which opens Android's **Save to…** picker.

## Status

**Built, installed and run on a Pixel 9a (Android 17)** on 2026-10-01:

- Chaquopy boots and Flask serves the phone UI.
- The Edition builds on-device.
- A YouTube video resolves through the yt-dlp shim and plays at 1080p via the
  synthesized adaptive HLS.
- Anime episodes resolve on-device.

Everything was checked through `adb forward` while the phone stayed locked. The
gestures, rotation, keyboard handling and Save-to picker have not been tried by
hand on the phone yet.

## Prerequisites

- Android SDK (API 34) + NDK r26b (`26.1.10909125`), JDK 17.
- Node 20+ (to build `phone/`).
- A uv-managed Python 3.12 for Chaquopy's build-time pip (see `buildPython` below).
- A device or emulator on **arm64-v8a** or **x86_64**.

## Build & run

```bash
cd android
ANDROID_HOME=~/Android/Sdk ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Before every build, Gradle runs two steps of its own (`app/build.gradle.kts`):
- `syncDesktopPython` copies `../server` and `../main.py` (as `desktop_main.py`)
  into `app/build/generated/desktop-python`, which Chaquopy packs beside
  `app/src/main/python`.
- `buildPhoneUi` refreshes the Python licence list (`tools/gen-licenses.py`),
  runs `npm ci` if `phone/node_modules` is missing, then builds the phone UI into
  the APK's assets.

- The first Gradle build pip-installs the Python deps into the APK, which is
  slow once.
- The service re-extracts the web assets on every (re)install, so a rebuilt APK
  always shows the new UI.
- A splash ("warming up the set…") covers the few seconds the server takes to
  start.

### Developing the phone UI

```bash
uv run python main.py              # (repo root) a desktop backend on :5000
cd android/phone && npm run dev    # phone UI on :5173 (/api proxied to :5000)
```

Open it in a browser at phone width. Every bridge call has a browser fallback
(Web Share → clipboard, `window.open`, `navigator.vibrate`), so the UI runs off
the phone too. Edit the phone's own files under `phone/src/{shell,player,screens,lib,styles}`.

- Desktop code is edited where it lives (`frontend/src`, `server/`), and the
  phone picks it up on its next build.
- When a desktop component changes its markup, check the matching overrides in
  `phone/src/styles/phone.css` (they target `pc_<dir>_<file>__<class>` names).

## Anime on-device

Episode and stream resolution uses `anipy-api`'s allanime scraper. Its declared
deps include native libs with no Chaquopy wheel (`Levenshtein` + `rapidfuzz`) and
desktop-only ones (`python-mpv`, `python-ffmpeg`), none of which the scraper path
imports. So, outside `server/`:

- **`app/src/main/python/anipy_api/`**: the package is *vendored* so Chaquopy never
  tries to pip-install those deps.
  - To update it, re-copy from the desktop venv's `site-packages/anipy_api`, and
    update its `NOTICE` (version, modified or not) and the licence list.
  - It's 3.8.21, unmodified. allanime itself is dead (`AA_CRYPTO_STALE`), so on
    both desktop and phone the hianime source (`server/sources/hianime.py`)
    resolves episodes and anipy is only a fallback.
- **`app/src/main/python/Levenshtein.py`**: a pure-Python shim (`ratio`/`distance`
  via `difflib`).
- **`app/src/main/python/weeb_cli/`**: the second scraper, vendored the same way.
- `app/build.gradle.kts` pip-installs only the pure or available runtime deps.

The fuzzy search fallback (`rapidfuzz`) has no wheel and degrades to a no-op, which is harmless.

## Syncing your *data* between PC and phone

`tools/sync-data.sh` moves **user data** between the two SQLite databases (the
code needs no syncing: both apps build from this repo). Stop the desktop server
first, then:

```bash
tools/sync-data.sh            # merge (default): two-way UNION of both sides
tools/sync-data.sh pull       # clone the WHOLE phone DB over the desktop one
tools/sync-data.sh push       # clone the WHOLE desktop DB over the phone one
```

The default **merge** unions the portable tables so both ends match afterwards:

- `subscriptions`, by platform + source_id.
- `history`, by item_id: the more recent watch wins, and resume + watch_count
  follow it.
- `saved`: set union.
- `oauth`: the valid token with the later expiry wins, so connecting
  **AniList/Reddit on one device logs you in on both**.

- the subtitle style (`settings.subtitle_style`): the side that changed it last wins.

`cache`, the other settings and the Archive (`brain_*`) stay per device on a merge; use
`push`/`pull` for a literal full-database clone. Every run backs up both sides
first (`<db>.bak-<stamp>`). It needs adb (the debug build's `run-as` reaches the
app's private DB) and `sqlite3` on the PC.

## Notes & troubleshooting

- **Toolchain**: AGP 8.2.2, Kotlin 1.9.22, Chaquopy 15.0.1, Gradle 8.2, compileSdk
  34, NDK r26b. Bump them together: Chaquopy, AGP and Kotlin must be mutually
  compatible. In the Kotlin DSL the Python config lives in a top-level
  `chaquopy { defaultConfig { … } }` block.
- **Python on the phone is 3.11** (Chaquopy), while the desktop targets 3.12.
  `server/` currently compiles under 3.11. Check after big backend changes:
  `uv python install 3.11` then compile every file with that interpreter.
- **`buildPython`**: Chaquopy runs `pip` at build time with a host Python 3.8–3.12
  (3.13+ dropped `cgi`, which Chaquopy 15's pip imports). `app/build.gradle.kts`
  points at a uv-managed 3.12. **Change that absolute path for your machine.**
- **yt-dlp breakage**: the phone's yt-dlp is pinned at build time. When YouTube
  changes, rebuild the APK (pip fetches the newest yt-dlp).
- **Battery**: a persistent "Tubcal is running" notification is shown while the
  foreground service is alive, so playback and live alerts keep working.
- **Debugging the on-device server**: `adb forward tcp:18137 tcp:8137` then open
  `http://127.0.0.1:18137` on the PC. `adb shell` itself can't reach the app's
  loopback port. Python's stdout/stderr go to logcat (`python.stdout`/`python.stderr`).

## License

Part of Tubcal, Copyright (C) 2026 shio-t0, under the GNU General Public License
version 3 or (at your option) any later version. See [LICENSE](../LICENSE). In the
app, Settings → About shows it.

[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) has an Android section listing
what the APK is built from and under which licences:
- the vendored anipy-api and weeb-cli, each with its own LICENSE and NOTICE in
  `app/src/main/python/`;
- the Python runtime and pip packages, listed in
  `app/src/main/legal/python-licenses.txt`, which `tools/gen-licenses.py` writes;
- every JavaScript library in the phone UI.

If you distribute the APK, distribute it under GPL-3.0, with this repository (or
the corresponding source) available.
