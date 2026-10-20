/* The Manual — the contents panel, the scroll-spy and the page's few
   instruments: the rooms table, the key finder, the "what works with what"
   checklist and the account cards. */

(function () {
  'use strict';
  const { $, $$, esc, icon, toast, copyText } = window.TC;
  const T = window.TUBCAL;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ── the contents panel + scroll-spy ──────────────────────────────────── */
  const nav = $('#man-nav');
  nav.innerHTML = T.manual
    .map((s, i) => `<a class="tc-navitem" href="#${s.id}" data-sec="${s.id}" style="--room-c:${s.c}"><span class="tc-navno">${pad2(i + 1)}</span><span class="nm">${esc(s.title)}</span></a>`)
    .join('');
  const links = $$('.tc-navitem', nav);
  const consoleEl = $('#console');
  const menuBtn = $('#con-menu');
  menuBtn.addEventListener('click', () => {
    const open = !consoleEl.classList.contains('open');
    consoleEl.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open);
  });
  links.forEach((a) => a.addEventListener('click', () => {
    consoleEl.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }));
  function spy() {
    let cur = T.manual[0].id;
    T.manual.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top < innerHeight * 0.3) cur = s.id;
    });
    links.forEach((a) => {
      const on = a.dataset.sec === cur;
      a.classList.toggle('tc-navitem-on', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    const on = links.find((a) => a.dataset.sec === cur);
    if (on && getComputedStyle(nav).display !== 'none') {
      const r = on.getBoundingClientRect(), nr = nav.getBoundingClientRect();
      if (r.top < nr.top || r.bottom > nr.bottom) nav.scrollTop += r.top - nr.top - nr.height / 2;
    }
  }
  addEventListener('scroll', spy, { passive: true });
  spy();

  /* ── channels & rooms: the rooms table, numbered inside each channel ───── */
  $('#rooms-table tbody').innerHTML = T.channels
    .map((ch) => {
      let n = 0;
      return `<tr class="grp"><th colspan="3">${ch.n} · ${esc(ch.label)}</th></tr>${T.rooms
        .filter((r) => r.channel === ch.id)
        .map((r) => `<tr><td class="nowrap"><b style="color:${r.color}">${r.on ? pad2(++n) : '—'}</b></td><td class="nowrap"><b>${esc(r.label)}</b>${r.on ? '' : '<br><small class="muted">off at first</small>'}${r.fixed ? '<br><small class="muted">always on</small>' : ''}</td><td><b>${esc(r.line)}</b> ${esc(r.body)}</td></tr>`)
        .join('')}`;
    })
    .join('');

  /* ── keyboard: the key finder ─────────────────────────────────────────── */
  const KEYS = [
    { scope: 'global', title: 'Everywhere', sub: 'every channel', note: 'Space then g opens a small menu of where you can go, so you don’t have to remember the letters.', rows: [
      [['Space', 'g', 's'], 'Go to the Social channel'],
      [['Space', 'g', 'c'], 'Go to the Coding channel'],
      [['Space', 'g', 'v'], 'Go to the Video channel'],
      [['Space', 'g', 'a'], 'Go to the Anime'],
      [['Space', 'g', 'h'], 'Go to the home screen'],
      [['Space', 's'], 'Open the Saved panel'],
      [['Space', ','], 'Open the Settings panel'],
      [['g', 'e'], 'The Edition'],
      [['g', 'n'], 'The Wire'],
      [['g', 'r'], 'The Dispatch'],
      [['g', 'c'], 'The Composing Room'],
      [['g', 'd'], 'The Workbench'],
      [['g', 'y'], 'The Screening Room'],
      [['g', 'a'], 'The Anime'],
      [['g', 's'], 'The Saved page'],
      [['g', 'h'], 'Home screen'],
      [['h', 'j', 'k', 'l'], 'Move between tiles: left, down, up, right (the arrow keys work too)'],
      [['g', 'g', '·', 'G'], 'First · last tile on the page'],
      [['/', 'or', 'Ctrl', 'K'], 'Search: jump to any room, search YouTube, Reddit and Hacker News, or find something you saved'],
    ] },
    { scope: 'home', title: 'The home screen', sub: 'the TV', rows: [
      [['1'], 'Channel 1, Social'],
      [['2'], 'Channel 2, Coding'],
      [['3'], 'Channel 3, Video'],
    ] },
    { scope: 'player', title: 'In the player', sub: 'while it’s on the big screen', rows: [
      [['Space', '/', 'K'], 'Play · pause'],
      [['J', 'L'], 'Back / forward 10 seconds'],
      [['←', '→'], 'Back / forward 5 seconds'],
      [['Ctrl', '←', '→'], 'Previous · next chapter'],
      [['0', '–', '9'], 'Jump to 0–90 % of the way through'],
      [['↑', '↓', '·', 'M'], 'Volume · mute'],
      [['<', '>'], 'Slower · faster'],
      [['F', '·', 'C'], 'Fullscreen · subtitles'],
      [['Shift', 'N'], 'Next video in Up next'],
      [['Esc'], 'Keep playing in the corner'],
      [['?'], 'Show these keys on screen'],
    ] },
    { scope: 'anime', title: 'The Anime', sub: 'the Reckoner', rows: [
      [['C'], 'Add the next unwatched episode of the title under your pointer; press again to add the one after'],
    ] },
    { scope: 'editor', title: 'The Composing Room', sub: 'leader = Space', note: 'The editor uses vim keys. Press the leader key (Space) and a menu shows what the next key does.', rows: [
      [['leader', 'f'], 'Find a file'],
      [['leader', 's'], 'Search the project'],
      [['leader', 'e'], 'Show or hide the file tree'],
      [['leader', 't'], 'Show or hide the terminal'],
      [['leader', 'w'], 'Save the file'],
      [['leader', 'q'], 'Close the file'],
      [['leader', 'v'], 'Split side by side'],
      [['leader', 'o'], 'Switch to the other side'],
      [['leader', 'r'], 'Run the file'],
      [['leader', 'g'], 'Refresh git status'],
      [['leader', 'b'], 'Save the file to Saved'],
      [[':w!'], 'Save over a file that changed on disk'],
    ] },
  ];
  const SCOPES = [['all', 'All'], ['global', 'Everywhere'], ['home', 'Home'], ['player', 'Player'], ['anime', 'Anime'], ['editor', 'Code editor']];
  let scope = 'all';
  const kt = $('#keytables');
  kt.innerHTML = KEYS.map((g) => `<div class="kgroup" data-scope="${g.scope}"><h4>${esc(g.title)}<small>${esc(g.sub)}</small></h4>
    ${g.note ? `<p class="knote">${esc(g.note)}</p>` : ''}
    ${g.rows.map((r) => `<div class="kr" data-keys="${esc(r[0].join(' ').toLowerCase())}" data-text="${esc(r[1].toLowerCase())}"><span class="keys">${r[0].map((k) => (['or', '·', '–', '/'].includes(k) && r[0].length > 1 && k !== '/' ? `<em>${k}</em>` : k === '/' && r[0][0] !== '/' ? '<em>/</em>' : `<kbd>${esc(k)}</kbd>`)).join('')}</span><span>${esc(r[1])}</span></div>`).join('')}</div>`).join('');
  $('#kf-scopes').innerHTML = SCOPES.map(([id, l]) => `<button class="chip${id === 'all' ? ' on' : ''}" data-scope="${id}" aria-pressed="${id === 'all'}">${l}</button>`).join('');
  $$('#kf-scopes .chip').forEach((b) => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    $$('#kf-scopes .chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    filterKeys();
  }));
  const kfIn = $('#kf-in');
  let pressed = '';
  const NAMES = { ' ': 'space', Control: 'ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'esc', Shift: 'shift' };
  function filterKeys() {
    const q = kfIn.value.trim().toLowerCase();
    let shown = 0;
    $$('.kgroup', kt).forEach((g) => {
      const inScope = scope === 'all' || g.dataset.scope === scope;
      let any = false;
      $$('.kr', g).forEach((r) => {
        const keys = r.dataset.keys.split(' ');
        let match = true, hit = false;
        if (pressed) { hit = keys.includes(pressed); match = hit; }
        else if (q.length === 1) { hit = keys.includes(q); match = hit; }
        else if (q) { match = r.dataset.text.includes(q) || r.dataset.keys.includes(q); hit = match; }
        r.hidden = !(inScope && match);
        r.classList.toggle('hit', hit && !r.hidden);
        if (!r.hidden) { any = true; shown++; }
      });
      g.hidden = !any;
    });
    $('#kf-count').textContent = pressed ? `“${pressed}” · ${shown} shortcut${shown === 1 ? '' : 's'}` : q ? `${shown} match${shown === 1 ? '' : 'es'}` : `${shown} shortcuts`;
  }
  kfIn.addEventListener('keydown', (e) => {
    const special = NAMES[e.key];
    if (special && !(e.key === ' ' && kfIn.value)) {
      if (e.key === 'Escape' && !kfIn.value && !pressed) return;
      e.preventDefault();
      e.stopPropagation();
      pressed = e.key === 'Escape' && pressed === 'esc' ? '' : special;
      kfIn.value = '';
      kfIn.placeholder = `Pressed: ${special} — type or press another key`;
      filterKeys();
    } else if (e.key === 'Backspace' && !kfIn.value && pressed) {
      pressed = '';
      kfIn.placeholder = 'Press a key, or type what you want to do…';
      filterKeys();
    } else if (e.key.length === 1) {
      pressed = '';
    }
  });
  kfIn.addEventListener('input', () => { pressed = ''; filterKeys(); });
  filterKeys();

  /* ── accounts: what works with what you have ──────────────────────────── */
  const HAVE = [
    ['Accounts', [
      ['anilist', 'An AniList account', 'free, at anilist.co'],
      ['reddit', 'A Reddit sign-in', 'your own Reddit account'],
      ['google', 'A YouTube sign-in', 'through your Google account'],
      ['github', 'A linked GitHub account', 'with the GitHub CLI or a token'],
    ]],
    ['Add-ons', [
      ['archive', 'The Archive room', 'picked in the installer'],
      ['ai', 'A local AI (Ollama)', 'with its two models'],
      ['notify', 'Desktop notifications', 'offered by the installer'],
    ]],
  ];
  const have = new Set();
  $('#mc-have').innerHTML = HAVE.map(([g, items]) => `<div class="mc-group">${g}</div>${items
    .map(([id, label, sub]) => `<label class="switch"><input type="checkbox" data-have="${id}"><span class="track"></span><span>${esc(label)}<small>${esc(sub)}</small></span></label>`)
    .join('')}`).join('');

  function features() {
    const h = (k) => have.has(k);
    const out = [];
    out.push(h('google')
      ? ['on', 'Screening Room', 'your subscriptions', 'Your YouTube subscriptions come in by themselves.']
      : ['on', 'Screening Room', 'works', 'Add channels by name or link. No account needed.']);
    out.push(h('reddit')
      ? ['on', 'The Dispatch', 'full', 'Scores, your home feed and full comment threads.']
      : ['part', 'The Dispatch', 'basic', 'Posts and comments, but no scores, and comments aren’t threaded.']);
    out.push(h('anilist')
      ? ['on', 'The Anime', 'everything', 'Your list, automatic progress updates, reviews and the social pages.']
      : ['off', 'The Anime', 'needs AniList', 'AniList no longer allows reading it without an account.']);
    if (h('ai')) out.push(['on', 'The Edition', 'written', 'Short articles for the top stories, and related posts grouped even when they link to different pages.']);
    else out.push(['part', 'The Edition', 'headlines', 'Headlines with points and comment counts. Posts that link to the same page are grouped.']);
    if (h('archive') && h('ai')) out.push(['on', 'The Archive', 'everything', 'Transcribes videos; you can search them, read summaries and ask questions.']);
    else if (h('archive')) out.push(['part', 'The Archive', 'transcripts', 'Transcribes videos. Search, summaries and questions also need the local AI.']);
    else out.push(['off', 'The Archive', 'not installed', 'Add it with tubcal add archive.']);
    out.push(h('notify')
      ? ['on', 'Live alerts', 'on', 'A desktop notification about ten minutes before a channel you follow goes live.']
      : ['off', 'Live alerts', 'off', 'Live streams still appear in the Screening Room, but you won’t get a notification.']);
    out.push(h('github')
      ? ['on', 'GitHub', 'your account', 'Your notifications, your open issues and pull requests, your stars, and 5,000 requests an hour.']
      : ['part', 'GitHub', 'public', 'The projects and people you follow, and what’s trending. GitHub allows 60 requests an hour without an account.']);
    out.push(['on', 'The Wire · The Workbench · the player · Saved', 'always', 'Work without any accounts or add-ons.']);
    return out;
  }
  let lastFeat = [];
  function renderFeatures() {
    const f = features();
    $('#mc-out').innerHTML = f.map(([s, name, tag, text], i) => {
      const changed = lastFeat[i] && (lastFeat[i][0] !== s || lastFeat[i][2] !== tag);
      return `<div class="mc-feat ${s}${changed && !reduce ? ' flash' : ''}"><span class="dot" aria-hidden="true"></span><b>${esc(name)}<small>${esc(tag)}</small></b><span>${esc(text)}</span></div>`;
    }).join('');
    lastFeat = f;
  }
  $$('[data-have]').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? have.add(cb.dataset.have) : have.delete(cb.dataset.have);
    renderFeatures();
  }));
  renderFeatures();

  /* ── accounts: how to connect each one ────────────────────────────────── */
  // The redirect address assumes Tubcal's usual address; Settings → Accounts
  // shows the exact one for this install, with a copy button.
  const ACCTS = [
    { id: 'anilist', name: 'AniList', c: 'var(--accent-strong)', tag: 'needed for the Anime',
      unlocks: 'The whole Anime room: your list, progress updates as you watch, reviews and the social pages.',
      steps: [
        'Make a free account at <b>anilist.co</b> if you don’t have one.',
        'On AniList, open <b>Settings → Developer</b> and create a new client. Give it any name, and paste the address below as its <b>Redirect URL</b>.',
        'Copy the client’s <b>ID</b> and <b>secret</b> into Tubcal’s <b>Settings → Accounts → AniList</b>, then press <b>Connect</b>.',
      ],
      note: 'The connection lasts about a year. When it runs out, Tubcal asks you to connect again.' },
    { id: 'reddit', name: 'Reddit', c: 'var(--c-reddit)', tag: 'optional',
      unlocks: 'Scores, your home feed and threaded comments. Without it you get posts and unthreaded comments.',
      steps: [
        'Signed in to Reddit, open <b>reddit.com/prefs/apps</b> and choose <b>create another app</b>.',
        'Pick the type <b>web app</b>, give it any name, and paste the address below as its <b>redirect uri</b>.',
        'Copy the app’s <b>ID</b> (under its name) and <b>secret</b> into <b>Settings → Accounts → Reddit</b>, then press <b>Connect</b>.',
      ] },
    { id: 'google', name: 'YouTube', c: 'var(--c-youtube)', tag: 'optional',
      unlocks: 'Imports the channels you already subscribe to on YouTube. Everything else works without it.',
      steps: [
        'In the <b>Google Cloud Console</b> (console.cloud.google.com), make a new project and turn on the <b>YouTube Data API v3</b>.',
        'Set up the consent screen and add your own Google address as a <b>test user</b>.',
        'Create an <b>OAuth client</b> of the type <b>Web application</b>, with the address below as an <b>authorised redirect URI</b>.',
        'Copy its <b>ID</b> and <b>secret</b> into <b>Settings → Accounts → Google · YouTube</b>, then press <b>Connect</b>.',
      ],
      note: 'Google will warn that the app isn’t verified. You can continue past the warning: the app is yours and only you use it.' },
    { id: 'github', name: 'GitHub', c: 'var(--c-github)', tag: 'optional', uri: false,
      unlocks: 'Your notifications, your open issues and pull requests, your stars, starring and commenting, and a much higher request limit. Following projects works without it.',
      steps: [
        '<b>If you use the GitHub CLI</b> (the <code>gh</code> command) and have signed in with <code>gh auth login</code>, open <b>Settings → Accounts → GitHub</b> and press <b>Link</b>. Tubcal uses the same sign-in.',
        '<b>Otherwise</b>, on GitHub create a <b>personal access token (classic)</b> with the <b>repo</b>, <b>notifications</b> and <b>user:follow</b> boxes ticked. The link in Settings opens that page with them already ticked.',
        'Paste the token into <b>Settings → Accounts → GitHub</b> and press <b>Link token</b>. Tubcal checks it with GitHub before keeping it.',
      ],
      note: 'The same panel is in the GitHub room. The token stays on your computer.' },
  ];
  $('#accts').innerHTML = ACCTS.map((a) => {
    const uri = `http://127.0.0.1:5000/api/oauth/${a.id}/callback`;
    return `<article class="acct" style="--ac:${a.c}">
      <h4>${esc(a.name)}<small>${esc(a.tag)}</small></h4>
      <p class="acct-unlocks">${a.unlocks}</p>
      <ol class="acct-steps">${a.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
      ${a.uri === false ? '' : `<div class="uri" title="Redirect address"><code>${uri}</code><button class="copy" data-uri="${uri}" aria-label="Copy the redirect address">${icon('copy')}</button></div>`}
      ${a.note ? `<p class="acct-note">${a.note}</p>` : ''}
    </article>`;
  }).join('');
  $$('[data-uri]', $('#accts')).forEach((b) => b.addEventListener('click', async () => {
    const ok = await copyText(b.dataset.uri);
    toast(ok ? 'Redirect address copied' : 'Copy failed');
  }));

  window.TC.wireCopyButtons();
})();
