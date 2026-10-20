/* Shared data for the Tubcal docs — skins, rooms and the two pages' sections.
   Skins and rooms mirror frontend/src/lib/themes.js and lib/rooms.js, but the
   words are written for someone using Tubcal, not building it. */

window.TUBCAL = {
  repo: 'https://github.com/Shio-T0/Tubcal',
  install: 'curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash',

  skins: [
    { value: 'dark', label: 'Shōwa Night', blurb: 'The default. Dark wood and amber, styled after an old TV set.', swatch: ['#1c140d', '#e6ab5e', '#e8d9b8'] },
    { value: 'light', label: 'Shōwa Day', blurb: 'The same TV-set style in light colours.', swatch: ['#e6d8bb', '#b06a26', '#2a1d12'] },
    { value: 'terminal', label: 'Phosphor Terminal', blurb: 'Green text on black, like an old computer terminal.', swatch: ['#05080a', '#33ff66', '#ffb000'] },
    { value: 'aqua', label: 'Aqua Y2K', blurb: 'Glossy blue and white, in the style of a 2000s desktop.', swatch: ['#eef3fb', '#1a73e8', '#28c840'] },
    { value: 'bauhaus', label: 'Bauhaus Print', blurb: 'Red, blue and black on off-white, like a printed poster.', swatch: ['#f4f1e9', '#e2231a', '#0b4ee2'] },
    { value: 'blueprint', label: 'Blueprint', blurb: 'Pale blue lines on navy, like a technical drawing.', swatch: ['#081a33', '#5fd0ff', '#ffb454'] },
    { value: 'space', label: 'Deep Space', blurb: 'See-through panels over a dark purple nebula.', swatch: ['#05060c', '#7c5cff', '#22d3ee'] },
    { value: 'bench', label: 'Cutting Mat', blurb: 'Dark windows laid out on a teal cutting mat.', swatch: ['#5f948f', '#8aadf4', '#1e2030'] },
  ],

  // The hub's rooms, in the app's default running order.
  rooms: [
    {
      id: 'edition', label: 'The Edition', color: 'var(--c-foryou)', chord: 'e', on: true,
      line: 'A front page made each morning from what you follow.',
      body: 'Each morning the biggest stories from your YouTube channels, subreddits and Hacker News go on one front page, and posts about the same story are combined. With a local AI, the top stories are written up as short articles that cite their sources. Without one, you get the headlines. Stories are ticked off as you read them, and old issues are kept.',
    },
    {
      id: 'youtube', label: 'Screening Room', color: 'var(--c-youtube)', chord: 'y', on: true,
      line: 'The YouTube channels you follow, without ads.',
      body: 'The newest upload is shown large, next to anything live and the videos you didn’t finish. Each channel has its own shelf, and there’s a list of every new upload by day and an up-next queue. “The Projection” suggests videos based only on what you’ve watched in Tubcal. You don’t need a YouTube account.',
    },
    {
      id: 'reddit', label: 'The Dispatch', color: 'var(--c-reddit)', chord: 'r', on: true,
      line: 'Your subreddits.',
      body: 'Your subreddits as readable pages, with search and comments. It works without signing in. If you connect your Reddit account, you also get scores and threaded comments.',
    },
    {
      id: 'hackernews', label: 'The Wire', color: 'var(--c-hn)', chord: 'n', on: true,
      line: 'Hacker News.',
      body: 'Top, Best, New, Ask, Show and Jobs, and a search of everything ever posted. A gauge on each story shows how fast it’s gaining points, and the comment count tells you how many are new since you last looked. Open a story and its comments appear beside the list.',
    },
    {
      id: 'archive', label: 'The Archive', color: 'var(--signal)', chord: '', on: true,
      line: 'Search what was said in videos you’ve watched.',
      body: 'When it’s turned on, Tubcal transcribes your videos on your own computer. You can then search the transcripts, read summaries, or ask something like “what did that talk say about sleep?” and get an answer that links to the exact moments. It’s optional and needs a local AI.',
    },
    {
      id: 'editor', label: 'The Composing Room', color: 'var(--c-editor)', chord: 'c', on: true,
      line: 'A code editor.',
      body: 'A full code editor with vim keys, a file tree, tabs, project search, git status and a built-in terminal. It can only open files inside one folder: your Projects folder, unless you choose another. If you don’t write code, turn this room off in Settings → Rooms.',
    },
    {
      id: 'github', label: 'GitHub', color: 'var(--c-github)', chord: '', on: false,
      line: 'Releases and activity from GitHub projects you follow.',
      body: 'New releases and recent activity from the projects you follow, plus what’s trending. It’s off by default; turn it on in Settings → Rooms. GitHub limits how many requests it answers per hour, so after heavy use the room may pause for a while.',
    },
    {
      id: 'dev', label: 'The Workbench', color: 'var(--c-dev)', chord: '', on: true,
      line: 'News for four programming languages.',
      body: 'A page each for Rust, Python, Go and TypeScript, with talks, podcasts you can play on the page, posts from each language’s core team, popular projects and the current version.',
    },
  ],

  // Sections on each page — they feed the command palette and the g-chords.
  tour: [
    { id: 'top', title: 'Top of the page', sub: 'What Tubcal is, and the install command', chord: '' },
    { id: 'hub', title: 'Channel 1 · The Hub', sub: 'YouTube, Reddit, Hacker News and more', chord: 'h' },
    { id: 'edition', title: 'The Edition', sub: 'The daily paper', chord: 'e' },
    { id: 'player', title: 'The player', sub: 'How videos play', chord: 'p' },
    { id: 'anime', title: 'Channel 2 · The Anime', sub: 'Screenshots of the anime screens', chord: 'a' },
    { id: 'look', title: 'Skins', sub: 'The eight looks', chord: 'l' },
    { id: 'privacy', title: 'Privacy', sub: 'Where your data goes', chord: 'v' },
    { id: 'get', title: 'Install', sub: 'One command, on Linux', chord: 's' },
  ],
  manual: [
    { id: 'install', title: 'Install', sub: 'One command in a terminal', chord: 'i', c: 'var(--signal)' },
    { id: 'first-steps', title: 'First steps', sub: 'Add channels and subreddits', chord: 'f', c: 'var(--c-foryou)' },
    { id: 'everyday', title: 'Starting & updating', sub: 'The tubcal command', chord: 'u', c: 'var(--c-hn)' },
    { id: 'rooms', title: 'Channels & rooms', sub: 'What each part does', chord: 'r', c: 'var(--c-foryou)' },
    { id: 'watching', title: 'Watching', sub: 'The player, subtitles, episodes', chord: 'p', c: 'var(--c-youtube)' },
    { id: 'anime', title: 'The Anime', sub: 'Your list, the Reckoner, the curtain call', chord: 'a', c: 'var(--accent-strong)' },
    { id: 'ai', title: 'Optional AI', sub: 'The Archive and the written paper', chord: 'e', c: 'var(--c-dev)' },
    { id: 'keyboard', title: 'Keyboard', sub: 'All shortcuts, with a search', chord: 'k', c: 'var(--c-hn)' },
    { id: 'settings', title: 'Settings', sub: 'What you can change', chord: 's', c: 'var(--c-editor)' },
    { id: 'accounts', title: 'Accounts', sub: 'Connecting YouTube, Reddit and AniList', chord: 'o', c: 'var(--c-reddit)' },
    { id: 'privacy', title: 'Privacy & your data', sub: 'What’s sent, and where data is kept', chord: 'v', c: 'var(--c-dev)' },
    { id: 'troubleshooting', title: 'Troubleshooting', sub: 'Fixes for common problems', chord: 't', c: 'var(--danger)' },
    { id: 'faq', title: 'Questions', sub: 'Short answers', chord: 'q', c: 'var(--c-github)' },
    { id: 'license', title: 'License', sub: 'Free software', chord: '', c: 'var(--paper-faint)' },
  ],
};
