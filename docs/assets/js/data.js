/* Shared data for the Tubcal docs — skins, rooms and the two pages' sections.
   Skins and rooms mirror frontend/src/lib/themes.js and lib/rooms.js. */

window.TUBCAL = {
  repo: 'https://github.com/Shio-T0/Tubcal',

  skins: [
    { value: 'dark', label: 'Shōwa Night', blurb: 'The house look — warm wood cabinet, amber tube.', swatch: ['#1c140d', '#e6ab5e', '#e8d9b8'] },
    { value: 'light', label: 'Shōwa Day', blurb: 'Same set, tatami daylight.', swatch: ['#e6d8bb', '#b06a26', '#2a1d12'] },
    { value: 'terminal', label: 'Phosphor Terminal', blurb: 'An older machine. Green text on a black tube.', swatch: ['#05080a', '#33ff66', '#ffb000'] },
    { value: 'aqua', label: 'Aqua Y2K', blurb: 'Glossy turn-of-the-century desktop.', swatch: ['#eef3fb', '#1a73e8', '#28c840'] },
    { value: 'bauhaus', label: 'Bauhaus Print', blurb: 'Off the screen — a constructivist poster.', swatch: ['#f4f1e9', '#e2231a', '#0b4ee2'] },
    { value: 'blueprint', label: 'Blueprint', blurb: 'Cyan hairlines on drafting navy.', swatch: ['#081a33', '#5fd0ff', '#ffb454'] },
    { value: 'space', label: 'Deep Space', blurb: 'Glass panels adrift over a nebula.', swatch: ['#05060c', '#7c5cff', '#22d3ee'] },
  ],

  // The hub's rooms, in the app's default running order.
  rooms: [
    {
      id: 'edition', label: 'The Edition', color: 'var(--c-foryou)', route: '/edition', chord: 'e', on: true,
      line: 'A daily front page composed on this machine.',
      body: 'The same story found across YouTube, Reddit and HN is clustered into one article and ranked by editorial salience. With Ollama running it is written up as grounded, citation-checked prose; without any AI it still prints a headlines-only “wire” edition. Built once a day in the background — opening the page is a single SQLite read.',
      tags: ['nameplate & back issues', 'lede with picture', 'ruled columns', 'In Brief by room', 'read ticks'],
    },
    {
      id: 'youtube', label: 'Screening Room', color: 'var(--c-youtube)', route: '/youtube', chord: 'y', on: true,
      line: 'Your YouTube, without YouTube.',
      body: 'The newest upload on a big screen beside what just came in and what’s live; pick up where you left off; The Projection — recommendations built only from your own watch history; a shelf per channel, busiest first. A Latest view of every upload by day, “new” badges per channel, an up-next queue, channel and playlist pages, and a day-by-day history.',
      tags: ['the Projection', 'Latest by day', 'up-next queue', 'live', 'history'],
    },
    {
      id: 'reddit', label: 'The Dispatch', color: 'var(--c-reddit)', route: '/reddit', chord: 'r', on: true,
      line: 'Reddit as an editorial broadsheet.',
      body: 'Serif headlines, per-subreddit pages, full-text search and threaded comments. Logged out, Reddit only serves RSS; an OAuth web app upgrades everything to full data.',
      tags: ['per-subreddit pages', 'full-text search', 'threaded comments'],
    },
    {
      id: 'hackernews', label: 'The Wire', color: 'var(--c-hn)', route: '/hackernews', chord: 'n', on: true,
      line: 'Hacker News on a teletype board.',
      body: 'Top, Best, New, Ask, Show and Jobs, and a search of the whole archive. Each line has a heat gauge and says how many comments arrived since you last read the thread; open one and the discussion sits beside the board — OP marked, branches foldable, new comments walked through.',
      tags: ['six lists', 'Algolia search', 'heat gauge', '+N since last read', 'foldable threads'],
    },
    {
      id: 'archive', label: 'The Archive', color: 'var(--signal)', route: '/archive', chord: '', on: true,
      line: 'A second brain over the videos you actually watched.',
      body: 'A background worker transcribes watched videos with Whisper, chunks and embeds the transcripts into SQLite, and answers questions with cosine search plus a local LLM — reading a little around each excerpt before it answers. Fully offline.',
      tags: ['faster-whisper', 'SQLite vectors', 'two-stage ask', 'Ollama', 'offline'],
    },
    {
      id: 'editor', label: 'The Composing Room', color: 'var(--c-editor)', route: '/editor', chord: 'c', on: true,
      line: 'A real code editor, vim-handed.',
      body: 'CodeMirror 6 with modal vim, file tree, tabs and splits, go-to-file, project grep, git gutter and branch, a which-key leader menu, session restore, an integrated PTY terminal and an optional LSP bridge. Sandboxed to one root directory.',
      tags: ['modal vim', 'PTY terminal', 'LSP bridge', 'git gutter', 'sandboxed'],
    },
    {
      id: 'github', label: 'GitHub', color: 'var(--c-github)', route: '/github', chord: '', on: false,
      line: 'Follow repositories as a room.',
      body: 'Read releases and activity from the repositories you follow. Off by default — switch it on in Settings → Rooms. A classic personal access token lifts GitHub’s 60 requests/hour ceiling to 5,000.',
      tags: ['releases', 'activity', 'trending', 'off by default'],
    },
    {
      id: 'dev', label: 'The Workbench', color: 'var(--c-dev)', route: '/dev', chord: '', on: true,
      line: 'One programming language per “service manual”.',
      body: 'Rust, Python, Go, TypeScript — curated facts and docs, talks, a podcast rail that plays in the page’s own bench radio, core-team blog updates, trending repos, and a best-effort “current stable” stamp. Adding a language is adding one dict.',
      tags: ['talks', 'bench radio', 'blog updates', 'trending repos', 'stable stamp'],
    },
  ],

  // Sections on each page — they feed the command palette and the g-chords.
  tour: [
    { id: 'top', title: 'The chooser', sub: 'Pick a channel', chord: '' },
    { id: 'hub', title: 'Channel 1 · The Hub', sub: 'The rooms, beside a console', chord: 'h' },
    { id: 'edition', title: 'The Edition', sub: 'A paper that degrades gracefully', chord: 'e' },
    { id: 'player', title: 'The player', sub: 'A theatre, not a pop-up', chord: 'p' },
    { id: 'anime', title: 'Channel 2 · The Anime', sub: 'All of AniList, the Reckoner, the curtain call', chord: 'a' },
    { id: 'look', title: 'The look', sub: 'Seven skins', chord: 'l' },
    { id: 'privacy', title: 'Privacy', sub: 'Bound to 127.0.0.1', chord: 'v' },
    { id: 'tune-in', title: 'Tune in', sub: 'Three commands', chord: 's' },
  ],
  manual: [
    { id: 'quick-start', title: 'Quick start', sub: 'Install, run, optional extras', chord: 'i', c: 'var(--signal)' },
    { id: 'channels', title: 'Channels & rooms', sub: 'The Hub, the Anime, the running order', chord: 'r', c: 'var(--c-foryou)' },
    { id: 'player', title: 'The player', sub: 'Streams, theatre, programme notes', chord: 'p', c: 'var(--c-youtube)' },
    { id: 'anime', title: 'The Anime', sub: 'AniList, watching, the Reckoner', chord: 'a', c: 'var(--accent-strong)' },
    { id: 'keyboard', title: 'Keyboard', sub: 'Every binding, with a key finder', chord: 'k', c: 'var(--c-hn)' },
    { id: 'configuration', title: 'Configuration', sub: 'Environment variables & a .env builder', chord: 'c', c: 'var(--c-editor)' },
    { id: 'accounts', title: 'Connecting accounts', sub: 'Reddit, Google, AniList, GitHub', chord: 'o', c: 'var(--c-reddit)' },
    { id: 'privacy', title: 'Privacy', sub: 'What leaves the machine', chord: 'v', c: 'var(--c-dev)' },
    { id: 'how-it-works', title: 'How it works', sub: 'Request flow, caching, streams, the brain', chord: 'w', c: 'var(--c-github)' },
    { id: 'api', title: 'API reference', sub: 'Every route the Flask app serves', chord: 'x', c: 'var(--c-hn)' },
    { id: 'layout', title: 'Project layout', sub: 'Where everything lives', chord: 'f', c: 'var(--c-editor)' },
    { id: 'develop', title: 'Develop', sub: 'Dev servers, tests, conventions', chord: 'd', c: 'var(--c-dev)' },
    { id: 'troubleshooting', title: 'Troubleshooting', sub: 'When a room goes quiet', chord: 't', c: 'var(--danger)' },
    { id: 'license', title: 'License', sub: 'MIT', chord: '', c: 'var(--paper-faint)' },
  ],

  // Environment variables (server/config.py). All optional.
  env: [
    { key: 'TUBCAL_PORT', def: '5000', purpose: 'Port to bind on 127.0.0.1.', kind: 'int' },
    { key: 'TUBCAL_OLLAMA_URL', def: 'http://127.0.0.1:11434', purpose: 'Local Ollama endpoint for The Archive and The Edition.', kind: 'url' },
    { key: 'TUBCAL_BRAIN_ASK_EXPAND', def: '3', purpose: 'How many excerpts The Archive reads more closely before answering (0 turns that off — one LLM call per question instead of two).', kind: 'int' },
    { key: 'TUBCAL_INVIDIOUS', def: '', defLabel: '(auto)', purpose: 'Comma-separated Invidious instances (trending, comments, search fallback).', kind: 'list' },
    { key: 'TUBCAL_EDITOR_ROOT', def: '~/Projects', purpose: 'The only directory the Composing Room can reach.', kind: 'path' },
    { key: 'TUBCAL_EDITOR_MAX_FILE_BYTES', def: '4194304', purpose: 'Refuse to open files larger than this (bytes).', kind: 'int' },
    { key: 'TUBCAL_GITHUB_TOKEN', def: '', defLabel: '(none)', purpose: 'A classic PAT — lifts GitHub’s 60 req/hr/IP ceiling to 5000. Can be pasted into Settings instead.', kind: 'secret' },
    { key: 'TUBCAL_ANIME_PROVIDER', def: '', defLabel: '(auto)', purpose: 'Prefer one anime scraper: allanime or animekai.', kind: 'enum', options: ['', 'allanime', 'animekai'] },
    { key: 'TUBCAL_ANIME_WATCHED_PERCENT', def: '80', purpose: 'Auto-mark an episode watched on AniList past this %. 0 disables.', kind: 'int' },
    { key: 'TUBCAL_AUTO_UPDATE', def: '1', purpose: 'Set 0 to stop upgrading anipy-api from PyPI on startup.', kind: 'enum', options: ['1', '0'] },
  ],
};
