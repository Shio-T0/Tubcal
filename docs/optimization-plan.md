# Tubcal optimization plan — footprint + load speed

## Context

Goal: make every load as fast as possible and shrink Tubcal's on-disk footprint,
without dropping features. This plan is built from **measured** state (2026-07-05),
not guesses. Tubcal is localhost single-user, so raw network transfer matters far
less than (a) JS parse/execute time, (b) disk footprint, (c) SQLite access latency.
Optimizations are ranked by impact ÷ effort; each names the file to touch.

## Measured baseline

| Area | Size / cost | Note |
|---|---|---|
| `data/` | **981 MB** | 95% is one file (below) |
| `data/brain/BpPEoZW5IiY.mp4` | **932 MB** | orphaned transcription download |
| `data/*.bak-*` snapshots | ~30 MB | 3 manual backups, never pruned |
| `data/tubcal.db` | 22 MB file / ~14 MB content | ~8 MB reclaimable (never VACUUMed) |
| `.venv` | 417 MB | ~irreducible optional ML (ctranslate2 135M, av 102M, onnxruntime 52M, numpy 60M) |
| `frontend/node_modules` | 134 MB | **tracked in git** (6830 files) since the merge |
| `.git` | 29 MB | history bloat from previously-committed db/dist/node_modules |
| initial JS bundle | **1,016 KB** (312 KB gzip) | single chunk, no code-splitting; hls.js + all pages + all fonts inside |
| CSS bundle | 193 KB | one chunk |
| hashed `/assets/*` | served `Cache-Control: no-cache`, **uncompressed** | forces revalidation every load |

## Track A — Disk footprint

### A1. Sweep orphaned transcription downloads  ⭐ biggest win (~932 MB now + prevents recurrence)
`server/brain/transcribe.py:78` downloads the full progressive mp4 to
`data/brain/{video_id}.mp4`; `server/brain/worker.py:73` deletes it in a `finally`.
If the process is **SIGKILLed** mid-download (exactly what happened repeatedly this
session), the `finally` never runs and the file orphans. There is no startup sweep.
- **Fix:** on brain worker start (`server/brain/worker.py` `_loop`, or `brain.start()`),
  before the poll loop, delete any `data/brain/*.mp4` not tied to an in-flight job.
  Since jobs are serial and none are in-flight at startup, simply `unlink` every
  `*.mp4` in `config.BRAIN_DIR` on boot.
- **Also:** reduce *peak transient* disk during a live transcription — stream the
  fetched bytes straight into faster-whisper via a temp file that is unlinked as
  soon as `transcribe()` returns (already the intent; the sweep covers the crash case).
- Delete the current 932 MB orphan immediately (safe — it's a leftover download).

### A2. Untrack `node_modules` + `__pycache__` from git  (repo ↓ ~134 MB tracked, faster clones)
The merge inherited 6830 tracked `node_modules` files and 31 `.pyc` files even though
`.gitignore` already lists them. `frontend/dist` was already cleaned.
- **Fix:** `git rm -r --cached frontend/node_modules server/**/__pycache__` then commit.
  Coordinate with the remote (the Windows branch author) so it isn't re-added.
- History bloat in `.git` (29 MB) only clears with a history rewrite
  (`git filter-repo`) — **defer**; risky on a shared remote, low payoff for a
  single-user project. Note it, don't do it unprompted.

### A3. Prune + VACUUM the database  (~8 MB reclaim, keeps it lean over time)
`server/db.py:240 prune_old_data()` deletes stale rows but never reclaims pages.
- **Fix:** switch the DB to `PRAGMA auto_vacuum=INCREMENTAL` (set at creation) and
  run `PRAGMA incremental_vacuum` at the end of `prune_old_data()`. For the existing
  file, a one-time `VACUUM` reclaims the ~8 MB now.
- The `cache` table (6.5 MB) and `brain_chunks` (4.8 MB) are legitimately sized; no
  change needed beyond the existing 7-day cache / 14-day vector prune.

### A4. Prune stale `.bak-*` snapshots  (~30 MB)
Nothing in code creates them — they're manual. Delete all but the newest, or add a
tiny keep-last-N sweep next to `prune_old_data`. Low effort, one-time ~26 MB.

### A5. `.venv` is mostly irreducible — document, don't fight it
417 MB is almost entirely the optional `brain` extra (ctranslate2/av/onnxruntime/
numpy). No torch (good). Base install without `--extra brain` is tiny. Only real
lever: `av` (PyAV, 102 MB) is pulled for audio decode; a system-ffmpeg decode path
could drop it, but that's deep and fragile. **Recommend:** leave as-is; make clear
in README that the 400 MB is the price of local AI and is opt-in.

## Track B — Load speed

### B1. Code-split the 1 MB bundle  ⭐ biggest perceived-speed win
`frontend/src/App.jsx:11-20` statically imports every page, so all rooms + `hls.js`
(~150 KB, `PlayerLayer.jsx:16`) land in one chunk parsed on every cold load.
- **Fix 1 — lazy routes:** wrap page imports in `React.lazy()` + a `<Suspense>`
  boundary in `App.jsx`. Front Page / Edition load first; other rooms load on nav.
- **Fix 2 — dynamic hls.js:** import `hls.js` with `await import('hls.js')` inside
  `PlayerLayer.jsx` when a stream actually opens, so it becomes its own chunk.
- **Fix 3 — vendor chunk:** add `build.rollupOptions.output.manualChunks` in
  `frontend/vite.config.js` to split `react`/`react-dom`/`react-router` into a
  long-cached vendor chunk.
- Target: initial JS ~1 MB → ~400–500 KB; player/other rooms load on demand.

### B2. Immutable caching for hashed assets  (removes a revalidation round-trip per load)
`server/__init__.py:30-32` serves `/assets/*` via `send_from_directory`, which yields
`Cache-Control: no-cache` → the browser revalidates every asset every load. Vite
content-hashes these filenames, so they are safe to cache forever.
- **Fix:** in the `after_request` hook (`server/__init__.py:12`), set
  `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (keep
  `no-store` for `/api/*`, `no-store`/short for `index.html`).

### B3. Trim shipped font subsets + lazy alternate-skin fonts  (dist ↓, fewer @font-face)
`frontend/src/main.jsx:5-17` eagerly imports 7 font families incl. VT323 (terminal
skin only), Archivo + Space Grotesk (other skins). Fontsource also ships latin-ext /
cyrillic / greek / vietnamese subsets that are rarely used.
- **Fix 1:** import only the needed **subset** CSS (e.g. `.../latin.css`) for the
  default Shōwa Set fonts instead of the whole family, shrinking `dist` and cutting
  @font-face count on first paint.
- **Fix 2:** load skin-specific fonts (VT323/Archivo/Space Grotesk) lazily when that
  theme is selected, not at boot.
- **Fix 3:** `<link rel="preload">` the 1–2 critical latin woff2 in `index.html` so
  the masthead paints without a font swap.

### B4. SQLite fast-read pragmas  (lower per-request DB latency)
`server/db.py:163` sets only `journal_mode=WAL`. On each connection also set:
- `PRAGMA synchronous=NORMAL` (safe under WAL; big write speedup),
- `PRAGMA mmap_size=268435456` (256 MB — read via mmap, avoids syscalls),
- `PRAGMA cache_size=-16000` (16 MB page cache),
- `PRAGMA temp_store=MEMORY`, `PRAGMA busy_timeout=5000`.
Centralize in the `connect()` helper so every connection gets them.

### B5. Precompress text assets at build  (optional; small on localhost)
Add a vite compression step (or Flask gzip) for JS/CSS. On localhost the transfer is
already fast, so this is a minor win versus B1 — do it only after B1/B2. The parse
cost that dominates is solved by code-splitting, not compression.

## Suggested order

1. **A1** delete the 932 MB orphan + add the startup sweep — instant ~1 GB back.
2. **A2** untrack node_modules/pyc (coordinate remote).
3. **B1** code-split (lazy routes + dynamic hls.js + vendor chunk).
4. **B2** immutable asset caching + **B4** SQLite pragmas — both tiny, high leverage.
5. **A3/A4** VACUUM + backup prune; **B3** font trimming.
6. Defer: A5 (venv), `.git` history rewrite, B5 (compression).

## Verification

- **Footprint:** `du -sh data .git frontend` before/after; expect `data/` ≈ 50 MB,
  tracked repo drops by ~134 MB. Kill the server mid-transcription, restart, confirm
  no `*.mp4` survives in `data/brain`.
- **Bundle:** `cd frontend && npm run build` — confirm multiple chunks and initial
  `index-*.js` roughly halved; hls.js in its own chunk. Load the app, open a video,
  confirm the player chunk fetches on demand (Network tab / build manifest).
- **Caching:** `curl -sD - http://127.0.0.1:5000/assets/index-*.js` shows
  `immutable`; `/api/*` still `no-store`.
- **DB:** `PRAGMA integrity_check` after VACUUM; `ls -l data/tubcal.db` shows ~14 MB;
  full suite green: `uv run --extra brain pytest` (currently 45 passed).
- **No regressions:** every room still routes, player still plays, Edition/Archive
  still build.
