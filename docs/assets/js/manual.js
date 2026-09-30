/* The Manual — the console, the scroll-spy and every instrument on the page:
   the machine checklist, the key finder, the .env builder, the redirect-URI
   cards, the boot stepper, the cache simulator, the path-containment tester,
   the API reference and the layout tree. */

(function () {
  'use strict';
  const { $, $$, esc, icon, toast, copyText } = window.TC;
  const T = window.TUBCAL;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REPO = T.repo;
  const pad2 = (n) => String(n).padStart(2, '0');
  let PORT = 5000;

  /* ── the console + scroll-spy ─────────────────────────────────────────── */
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

  /* ── 02 · the rooms table ─────────────────────────────────────────────── */
  let n = 0;
  $('#rooms-table tbody').innerHTML = T.rooms
    .map((r) => `<tr><td class="nowrap"><b style="color:${r.color}">${r.on ? pad2(++n) : '—'}</b></td><td class="nowrap"><b>${esc(r.label)}</b>${r.on ? '' : '<br><small class="muted">off by default</small>'}</td><td class="nowrap"><code>${r.route}</code></td><td>${esc(r.line)} ${esc(r.body)}</td></tr>`)
    .join('');

  /* ── 01 · what do you have? ──────────────────────────────────────────── */
  const HAVE = [
    ['Extras', [
      ['brain', 'uv sync --extra brain', 'faster-whisper + numpy'],
      ['editor', 'uv sync --extra editor', 'flask-sock'],
    ]],
    ['Local tools', [
      ['embed', 'Ollama + an embed model', 'nomic-embed-text by default'],
      ['chat', 'Ollama + a chat model', 'qwen3.5:9b by default'],
      ['rg', 'ripgrep (rg)', 'fast project grep'],
      ['lsp', 'A language server', 'rust-analyzer, pyright, …'],
      ['notify', 'notify-send', 'desktop notifications'],
    ]],
    ['Accounts', [
      ['anilist', 'AniList connected', 'OAuth'],
      ['reddit', 'Reddit OAuth app', 'web app'],
      ['google', 'Google OAuth client', 'YouTube Data API v3'],
      ['github', 'GitHub token', 'classic PAT'],
    ]],
  ];
  const have = new Set();
  $('#mc-have').innerHTML = HAVE.map(([g, items]) => `<div class="mc-group">${g}</div>${items
    .map(([id, label, sub]) => `<label class="switch"><input type="checkbox" data-have="${id}"><span class="track"></span><span>${esc(label)}<small>${esc(sub)}</small></span></label>`)
    .join('')}`).join('');

  function features() {
    const h = (k) => have.has(k);
    const out = [];
    // The Edition
    if (h('chat')) out.push(['on', 'The Edition', 'edited', `Written, citation-checked prose${h('brain') && h('embed') ? ' over semantic clusters' : ' over URL hard-link clusters'}.`]);
    else if (h('brain') && h('embed')) out.push(['part', 'The Edition', 'semantic', 'The same story clustered across rooms; template prose.']);
    else out.push(['part', 'The Edition', 'wire', `Headlines and numbers; stories cluster when they link the same URL.${h('embed') && !h('brain') ? ' (Semantic clustering also needs numpy, from the brain extra.)' : ''}`]);
    // The Archive
    if (h('brain') && h('embed') && h('chat')) out.push(['on', 'The Archive', 'full', 'Transcribes, searches and answers — fully offline.']);
    else if (h('brain') && h('embed')) out.push(['part', 'The Archive', 'search', 'Transcribes and searches; answers and summaries need a chat model.']);
    else if (h('brain')) out.push(['part', 'The Archive', 'transcribe', 'Whisper can transcribe; search needs an embed model in Ollama.']);
    else out.push(['off', 'The Archive', 'unavailable', 'Reports itself unavailable until the brain extra is installed.']);
    // Composing Room
    const grep = h('rg') ? 'fast project grep' : 'grep falls back to os.walk';
    if (h('editor') && h('lsp')) out.push(['on', 'The Composing Room', 'full', `Vim editor, PTY terminal and LSP completion; ${grep}.`]);
    else if (h('editor')) out.push(['part', 'The Composing Room', 'no LSP', `Vim editor and terminal; completion needs a language server; ${grep}.`]);
    else out.push(['part', 'The Composing Room', 'editor only', `A full vim editor — no terminal or LSP bridge; ${grep}.`]);
    // Rooms that depend on accounts
    out.push(h('google') ? ['on', 'Screening Room', 'imported', 'Your real YouTube subscriptions, imported.'] : ['on', 'Screening Room', 'rss', 'Add channels in Settings — RSS, no account needed.']);
    out.push(h('reddit') ? ['on', 'The Dispatch', 'full', 'Scores and full threaded comments.'] : ['part', 'The Dispatch', 'rss only', 'Reddit only serves RSS logged out — no scores, flattened comments.']);
    out.push(h('anilist') ? ['on', 'The Anime', 'connected', 'Your list, progress sync, the social side — everything.'] : ['off', 'The Anime', 'needs AniList', 'AniList refuses unauthenticated queries.']);
    out.push(h('github') ? ['on', 'GitHub room', '5,000 / hr', 'Plenty of headroom (the room is off by default — switch it on in Settings → Rooms).'] : ['part', 'GitHub room', '60 / hr', 'Works, cached hard; a PAT lifts the ceiling (the room is off by default).']);
    out.push(h('notify') ? ['on', 'Live pings', 'on', 'A desktop notification ~10 min before a subscribed stream goes live.'] : ['off', 'Live pings', 'skipped', 'Quietly skipped without notify-send.']);
    out.push(['on', 'The Wire · The Workbench · the player', 'always', 'Need nothing beyond the basics.']);
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

  /* ── 05 · keyboard ────────────────────────────────────────────────────── */
  const KEYS = [
    { scope: 'global', title: 'Everywhere', sub: 'the hub & the anime', rows: [
      [['Space', 'g', 'h'], 'The Hub (opens The Edition), from anywhere'],
      [['Space', 'g', 'a'], 'The Anime, from anywhere'],
      [['g', 'e'], 'Jump to The Edition'],
      [['g', 'y'], 'Jump to the Screening Room'],
      [['g', 'r'], 'Jump to The Dispatch'],
      [['g', 'n'], 'Jump to The Wire'],
      [['g', 'c'], 'Jump to The Composing Room'],
      [['g', 's'], 'Jump to Saved'],
      [['g', 'h'], 'Home — the channel chooser'],
      [['h', 'j', 'k', 'l'], 'Move a roving focus across tiles by geometry — shelves and walls alike'],
      [['g', 'g', '·', 'G'], 'First · last tile on the page'],
      [['/', 'or', 'Ctrl', 'K'], 'Command palette — every room, and search across YouTube, Reddit and HN'],
    ] },
    { scope: 'chooser', title: 'The chooser', sub: '/', rows: [
      [['1'], 'Channel 1 — the Hub'],
      [['2'], 'Channel 2 — the Anime'],
    ] },
    { scope: 'player', title: 'In the player', sub: 'while it’s expanded', rows: [
      [['Space', '/', 'K'], 'Play · pause'],
      [['J', 'L'], 'Back / forward 10 seconds'],
      [['←', '→'], 'Back / forward 5 seconds'],
      [['Ctrl', '←', '→'], 'Previous · next chapter'],
      [['0', '–', '9'], 'Jump to 0–90 %'],
      [['↑', '↓', '·', 'M'], 'Volume · mute'],
      [['<', '>'], 'Slower · faster'],
      [['F', '·', 'C'], 'Fullscreen · captions'],
      [['Shift', 'N'], 'Next in Up next'],
      [['Esc'], 'Keep playing in the corner'],
      [['?'], 'This list, on screen'],
    ] },
    { scope: 'anime', title: 'The Anime', sub: 'the Reckoner', rows: [
      [['C'], 'Tally the next unwatched episode of the title you’re hovering; each further C extends the run'],
    ] },
    { scope: 'editor', title: 'The Composing Room', sub: 'leader = Space', note: 'Real modal vim. The which-key menu opens on <leader> in normal mode; one more key runs the binding.', rows: [
      [['leader', 'f'], 'Find file'],
      [['leader', 's'], 'Search the project'],
      [['leader', 'e'], 'Toggle the index (file tree)'],
      [['leader', 't'], 'Toggle the terminal'],
      [['leader', 'w'], 'Write the buffer'],
      [['leader', 'q'], 'Close the buffer'],
      [['leader', 'v'], 'Split vertically'],
      [['leader', 'o'], 'Other pane'],
      [['leader', 'r'], 'Run the file'],
      [['leader', 'g'], 'Refresh git'],
      [[':w!'], 'Force a write over an on-disk change (mtime conflict)'],
    ] },
  ];
  const SCOPES = [['all', 'All'], ['global', 'Everywhere'], ['chooser', 'Chooser'], ['player', 'Player'], ['anime', 'Anime'], ['editor', 'Composing Room']];
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
    $('#kf-count').textContent = pressed ? `“${pressed}” · ${shown} binding${shown === 1 ? '' : 's'}` : q ? `${shown} match${shown === 1 ? '' : 'es'}` : `${shown} bindings`;
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

  /* ── 06 · the .env builder ────────────────────────────────────────────── */
  const ebForm = $('#eb-form');
  ebForm.innerHTML = T.env.map((v) => {
    const field = v.kind === 'enum'
      ? `<select id="eb-${v.key}" data-env="${v.key}">${v.options.map((o) => `<option value="${o}">${o || '(auto)'}${o === v.def ? ' — default' : ''}</option>`).join('')}</select>`
      : `<input id="eb-${v.key}" data-env="${v.key}" type="${v.kind === 'secret' ? 'password' : 'text'}" ${v.kind === 'int' ? 'inputmode="numeric"' : ''} placeholder="${esc(v.def || v.defLabel || '')}" autocomplete="off" spellcheck="false">`;
    return `<div class="eb-row" data-row="${v.key}"><label for="eb-${v.key}">${v.key}<small>default ${esc(v.defLabel || v.def)}</small></label>${field}<p>${esc(v.purpose)}</p><span class="bad" hidden></span></div>`;
  }).join('');
  function validate(v, val) {
    if (!val) return '';
    if (v.kind === 'int' && !/^\d+$/.test(val)) return 'Needs a whole number.';
    if (v.key === 'TUBCAL_PORT' && (+val < 1 || +val > 65535)) return 'Ports run from 1 to 65535.';
    if (v.key === 'TUBCAL_ANIME_WATCHED_PERCENT' && +val > 100) return 'A percentage: 0–100 (0 disables).';
    if (v.kind === 'url' && !/^https?:\/\//.test(val)) return 'Starts with http:// or https://';
    if (v.kind === 'list' && val.split(',').some((x) => x.trim() && !/^https?:\/\//.test(x.trim()))) return 'Each instance is a full URL, comma-separated.';
    return '';
  }
  let envText = '';
  function renderEnv() {
    const lines = [];
    let bad = false;
    T.env.forEach((v) => {
      const el = $(`#eb-${v.key}`);
      const val = el.value.trim();
      const row = $(`[data-row="${v.key}"]`);
      const msg = validate(v, val);
      const badEl = $('.bad', row);
      badEl.hidden = !msg;
      badEl.textContent = msg;
      if (msg) bad = true;
      const changed = val !== '' && val !== v.def && !msg;
      row.classList.toggle('changed', changed);
      if (changed) lines.push(`${v.key}=${val}`);
    });
    envText = lines.length ? `# Tubcal overrides — anything not listed keeps its default\n${lines.join('\n')}\n` : '';
    $('#eb-pre').innerHTML = lines.length
      ? `<span class="c"># Tubcal overrides — anything not listed keeps its default</span>\n${lines.map((l) => { const i = l.indexOf('='); return `<span class="k">${esc(l.slice(0, i))}</span>=<span class="s">${esc(l.slice(i + 1).replace(/./g, (c, k, s) => (l.startsWith('TUBCAL_GITHUB_TOKEN') && k > 3 ? '•' : c)))}</span>`; }).join('\n')}`
      : `<span class="c"># Nothing to override — every default holds.\n# Change a field on the left and it appears here.${bad ? '\n# (fix the highlighted field first)' : ''}</span>`;
    const portVal = $('#eb-TUBCAL_PORT').value.trim();
    const p = /^\d+$/.test(portVal) && +portVal > 0 && +portVal < 65536 ? +portVal : 5000;
    if (p !== PORT) { PORT = p; $('#acct-port').value = p; renderAccounts(); renderApi(); renderBoot(); }
  }
  $$('[data-env]', ebForm).forEach((el) => el.addEventListener('input', renderEnv));
  const ebCopy = $('#eb-copy');
  ebCopy.dataset.wired = '1';
  ebCopy.innerHTML = `${icon('copy')}<span>Copy</span>`;
  ebCopy.addEventListener('click', async () => {
    if (!envText) { toast('Nothing to copy yet — every default holds'); return; }
    const ok = await copyText(envText);
    toast(ok ? '.env copied' : 'Copy failed');
  });
  const ebDl = $('#eb-dl');
  ebDl.dataset.wired = '1';
  ebDl.innerHTML = `${icon('download')}<span>.env</span>`;
  ebDl.setAttribute('aria-label', 'Download .env');
  ebDl.addEventListener('click', () => {
    if (!envText) { toast('Nothing to save yet — every default holds'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([envText], { type: 'text/plain' }));
    a.download = '.env';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  renderEnv();

  /* ── 07 · accounts ────────────────────────────────────────────────────── */
  const ACCTS = [
    { id: 'reddit', name: 'Reddit', c: 'var(--c-reddit)', tag: 'OAuth · refreshes', unlocks: 'Scores, full threaded comments and real listings — instead of the RSS Reddit serves anonymous clients.', create: 'An OAuth <b>web app</b> at reddit.com/prefs/apps; paste its id and secret into Settings → Connections.', scope: '<code>read mysubreddits identity</code>' },
    { id: 'google', name: 'YouTube / Google', c: 'var(--c-youtube)', tag: 'OAuth · refreshes', unlocks: 'Your real YouTube subscriptions, pulled in. Everything else about YouTube already works without it.', create: 'An OAuth <b>Web application</b> client in a Google Cloud project with the <b>YouTube Data API v3</b> enabled.', scope: '<code>youtube.readonly</code>' },
    { id: 'anilist', name: 'AniList', c: 'var(--accent-strong)', tag: 'required for the Anime', unlocks: 'The whole Anime channel — AniList refuses unauthenticated queries. Your list, progress sync, reviews and the social side.', create: 'An API client in AniList’s developer settings; paste its id and secret into Settings.', scope: 'none — AniList tokens are full-access; they last about a year and have no refresh, so reconnect when one expires.' },
    { id: 'github', name: 'GitHub', c: 'var(--c-github)', tag: 'token · no OAuth', unlocks: '5,000 API requests an hour instead of 60 per IP.', create: 'A classic personal access token. Paste it into Settings, or set <code>TUBCAL_GITHUB_TOKEN</code>.', scope: 'public data only needs no scopes', noRedirect: true },
  ];
  const accts = $('#accts');
  function renderAccounts() {
    accts.innerHTML = ACCTS.map((a) => {
      const uri = `http://127.0.0.1:${PORT}/api/oauth/${a.id}/callback`;
      return `<article class="acct" style="--ac:${a.c}">
        <h4>${esc(a.name)}<small>${esc(a.tag)}</small></h4>
        <dl><dt>Unlocks</dt><dd>${a.unlocks}</dd><dt>Create</dt><dd>${a.create}</dd><dt>Scope</dt><dd>${a.scope}</dd></dl>
        ${a.noRedirect ? '<div class="uri"><code>No redirect URI — there is no OAuth flow for GitHub.</code></div>'
          : `<div class="uri" title="Redirect URI"><code>${uri}</code><button class="copy" data-uri="${uri}" aria-label="Copy redirect URI">${icon('copy')}</button></div>`}
      </article>`;
    }).join('');
    $$('[data-uri]', accts).forEach((b) => b.addEventListener('click', async () => {
      const ok = await copyText(b.dataset.uri);
      toast(ok ? 'Redirect URI copied' : 'Copy failed');
    }));
  }
  $('#acct-port').addEventListener('input', (e) => {
    const v = +e.target.value;
    if (v > 0 && v < 65536) { PORT = v; renderAccounts(); renderApi(); renderBoot(); }
  });
  renderAccounts();

  /* ── 09 · boot sequence ───────────────────────────────────────────────── */
  const BOOT = [
    ['updater.check_and_update()', 'Upgrade anipy-api from PyPI before anything imports it — best-effort, offline-safe; TUBCAL_AUTO_UPDATE=0 skips it.', '<span class="dim">updater</span> anipy-api is current'],
    ['db.init_db()', 'Create or migrate data/tubcal.db, seed default settings, strip retired room ids.', '<span class="dim">db</span> data/tubcal.db <span class="ok">ready</span>'],
    ['create_app()', 'Flask app, the nine blueprints, frontend/dist as the SPA; /api/* forced no-store.', '<span class="dim">app</span> 9 blueprints registered'],
    ['_warm_caches()', 'Prime The Projection (yt:discover:US) in the background so it’s ready before the browser opens.', '<span class="dim">cache</span> warming yt:discover:US <span class="am">(background)</span>'],
    ['_backfill_avatars()', 'One-shot thread: fetch channel avatars for subscriptions added by id without one.', '<span class="dim">subs</span> avatar backfill <span class="am">(background)</span>'],
    ['notifier.start()', 'Poll upcoming subscribed streams; notify-send ~10 min before one goes live (no-op without it).', '<span class="dim">notifier</span> watching for live streams'],
    ['brain.start()', 'The Archive worker: transcribe → chunk → embed. Degrades gracefully without the extra or Ollama.', '<span class="dim">brain</span> worker up'],
    ['brain.edition.start()', 'The Edition builder: one paper a day, a heartbeat every ten minutes, never on the request path.', '<span class="dim">edition</span> builder up'],
    ['app.run()', 'Bound to 127.0.0.1 and nothing else, threaded.', ''],
  ];
  let bootAt = -1;
  const bootSteps = $('#boot-steps');
  const bootTerm = $('#boot-term');
  bootSteps.innerHTML = BOOT.map((b, i) => `<li data-i="${i}"><i>${i + 1}</i><span><code>${esc(b[0])}</code><small>${esc(b[1])}</small></span></li>`).join('');
  function renderBoot() {
    $$('li', bootSteps).forEach((li, i) => {
      li.classList.toggle('done', i < bootAt);
      li.classList.toggle('now', i === bootAt);
    });
    const lines = ['<span class="dim">$ uv run python main.py</span>'];
    BOOT.forEach((b, i) => { if (i <= bootAt && b[2]) lines.push(b[2]); });
    if (bootAt >= BOOT.length - 1) lines.push('', `  <span class="am">Tubcal — private social hub</span>`, `  http://127.0.0.1:${PORT}`, '');
    bootTerm.innerHTML = lines.join('<br>');
    $('#boot-next').textContent = bootAt < 0 ? 'Power on' : bootAt >= BOOT.length - 1 ? 'On air ✓' : `Next: ${BOOT[bootAt + 1][0]}`;
    $('#boot-next').disabled = bootAt >= BOOT.length - 1;
  }
  $('#boot-next').addEventListener('click', () => { if (bootAt < BOOT.length - 1) { bootAt++; renderBoot(); } });
  $('#boot-reset').addEventListener('click', () => { bootAt = -1; renderBoot(); });
  renderBoot();

  /* ── 09 · the cache simulator ─────────────────────────────────────────── */
  const TTL = 10;
  const cs = { clock: 0, mem: null, db: null, v: 0, resp: null, log: [] };
  const up = $('#cs-up');
  const swr = $('#cs-swr');
  const mmss = (m) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
  const age = (e) => cs.clock - e.at;
  const fresh = (e) => age(e) < TTL;
  function log(kind, text) {
    cs.log.push([cs.clock, kind, text]);
    if (cs.log.length > 40) cs.log.shift();
  }
  function store(v) {
    cs.mem = { v, at: cs.clock };
    cs.db = { v, at: cs.clock };
  }
  function request() {
    let entry = cs.mem;
    let from = 'memory';
    if (!entry && cs.db) {
      entry = cs.mem = { ...cs.db };
      from = 'SQLite';
      log('ok', 'memory miss → row loaded from SQLite into memory');
    }
    if (entry && fresh(entry)) {
      cs.resp = { kind: 'fresh', text: `payload v${entry.v} from ${from}`, sub: `fresh · ${mmss(age(entry))} old` };
      log('ok', `<b>hit</b> — v${entry.v} served from ${from}, no upstream call`);
      return;
    }
    if (entry && swr.checked) {
      cs.resp = { kind: 'stale', text: `payload v${entry.v}, instantly`, sub: `stale · ${mmss(age(entry))} old · refresh started` };
      log('warn', `<b>stale-while-revalidate</b> — v${entry.v} returned at once; refreshing in the background`);
      if (up.checked) { cs.v++; store(cs.v); log('ok', `background refresh stored <b>v${cs.v}</b> for the next request`); }
      else log('err', '<b>background refresh failed</b> — keep serving the stale row');
      return;
    }
    if (up.checked) {
      cs.v++;
      store(cs.v);
      cs.resp = { kind: 'fresh', text: `payload v${cs.v} from upstream`, sub: entry ? 'expired row replaced' : 'cold cache filled' };
      log('ok', `${entry ? '<b>expired</b>' : '<b>miss</b>'} — fetched upstream, stored <b>v${cs.v}</b> in both layers`);
    } else if (entry) {
      cs.resp = { kind: 'stale', text: `payload v${entry.v} (stale)`, sub: `upstream failed · served ${mmss(age(entry))}-old row` };
      log('warn', `<b>upstream failed</b> — served the expired v${entry.v} instead of an error`);
    } else {
      cs.resp = { kind: 'err', text: 'err("…", 502)', sub: 'cold cache and upstream down — nothing to fall back on' };
      log('err', '<b>upstream failed</b> with a cold cache — the only case that errors');
    }
  }
  function layerHTML(name, where, e) {
    if (!e) return `<span class="kicker">${name}</span><span class="cs-badge empty">empty</span><span>${where}</span>`;
    const f = fresh(e);
    return `<span class="kicker">${name}</span><b>payload v${e.v}</b><span class="cs-badge ${f ? 'fresh' : 'stale'}">${f ? 'fresh' : 'expired · kept'}</span><span>${mmss(age(e))} old · ttl ${TTL}:00</span>`;
  }
  function renderCache(pulse) {
    $('#cs-clock').textContent = mmss(cs.clock);
    $('#cs-mem').innerHTML = layerHTML('memory', 'lost on restart', cs.mem);
    $('#cs-db').innerHTML = layerHTML('SQLite · cache table', 'survives restarts', cs.db);
    const r = cs.resp;
    $('#cs-resp').innerHTML = r ? `<span class="kicker">response</span><b>${esc(r.text)}</b><span class="cs-badge ${r.kind}">${r.kind === 'err' ? 'error' : r.kind}</span><span>${esc(r.sub)}</span>` : '<span class="kicker">response</span><span>Press “Request the feed”.</span>';
    $('#cs-log').innerHTML = cs.log.map(([t, k, s]) => `<li class="${k}"><span>${mmss(t)}</span>${s}</li>`).join('');
    if (pulse && !reduce) ['#cs-resp'].forEach((s) => { const el = $(s); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); });
  }
  $$('[data-cs]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.cs;
    if (a === 'req') request();
    if (a === 'tick') { cs.clock += 4; log('', 'four minutes pass'); }
    if (a === 'restart') { cs.mem = null; log('warn', '<b>restart</b> — the memory layer is gone; SQLite still has the row'); }
    renderCache(a === 'req');
  }));
  up.addEventListener('change', () => { log(up.checked ? 'ok' : 'err', up.checked ? 'upstream is back' : '<b>upstream down</b> (say, Reddit answering 429)'); renderCache(); });
  swr.addEventListener('change', () => { log('', swr.checked ? 'mode: <b>cached_swr()</b> — never waits on a warm cache' : 'mode: <b>cached()</b>'); renderCache(); });
  renderCache();

  /* ── 09 · path containment ────────────────────────────────────────────── */
  function norm(p) {
    const out = [];
    p.split('/').forEach((s) => {
      if (!s || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return `/${out.join('/')}`;
  }
  function checkPath() {
    const root = norm($('#pt-root').value.trim() || '/');
    const rel = $('#pt-in').value.trim();
    const joined = rel.startsWith('/') ? rel : `${root}/${rel}`;
    const p = norm(joined);
    const inside = p === root || p.startsWith(root === '/' ? '/' : `${root}/`);
    const out = $('#pt-out');
    out.style.setProperty('--pt-c', inside ? 'var(--success)' : 'var(--danger)');
    const why = rel.startsWith('/') ? 'An absolute path replaces the root entirely under pathlib, ' : rel.split('/').includes('..') ? 'The ../ segments are resolved first, ' : '';
    out.innerHTML = inside
      ? `<b>allowed</b><span>resolves to <code>${esc(p)}</code> — inside the root.</span>`
      : `<b>400 · path escapes the workspace: ${esc(JSON.stringify(rel).replace(/"/g, "'"))}</b><span>${why}${why ? 'and ' : ''}it resolves to <code>${esc(p)}</code>, which is not under <code>${esc(root)}</code>.</span>`;
  }
  const TRIES = ['lantern/src/main.rs', 'lantern/./src/../Cargo.toml', '../.ssh/id_ed25519', '/etc/passwd', 'lantern/../../Projects-old/secrets', '/home/you/Projects/lantern/README.md', ''];
  $('#pt-try').innerHTML = TRIES.map((t) => `<button class="chip" data-try="${esc(t)}">${t ? esc(t) : '(empty — the root itself)'}</button>`).join('');
  $$('[data-try]').forEach((b) => b.addEventListener('click', () => { $('#pt-in').value = b.dataset.try; checkPath(); }));
  $('#pt-in').addEventListener('input', checkPath);
  $('#pt-root').addEventListener('input', checkPath);
  checkPath();

  /* ── 10 · the API reference ───────────────────────────────────────────── */
  const ROUTES = window.TUBCAL_ROUTES || [];
  const BPS = [
    ['feeds', 'YouTube, Reddit, HN and GitHub feeds; video streams, HLS synthesis and the segment proxy; history, progress and saved items; search-everything.'],
    ['subscriptions', 'Follow and unfollow — resolves a channel, subreddit or repo you paste into an id.'],
    ['settings', 'The key/value settings stored in SQLite.'],
    ['oauth', 'Optional connections: paste credentials, run the flow, disconnect.'],
    ['edition', 'The Edition — the latest paper, back issues, status and a rebuild trigger.'],
    ['brain', 'The Archive — status, indexed documents, semantic search, ask, summaries and a digest.'],
    ['editor', 'The Composing Room — tree, files (atomic writes behind mtime preconditions), grep, git and session; plus the PTY and LSP sockets.'],
    ['dev', 'The Workbench — one endpoint per shelf, so each loads and fails independently.'],
    ['anime', 'The Anime — AniList reads and writes, the social side, reviews, the schedule, episodes and streams.'],
  ];
  const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'WS'];
  const mOn = new Set(METHODS);
  let bpOn = 'all';
  $('#api-methods').innerHTML = METHODS.map((m) => `<button class="chip on" data-m="${m}" aria-pressed="true" style="--chip-c:var(--mc)"><span class="m m-${m}" style="background:none;color:inherit;height:auto">${m}</span> ${ROUTES.filter((r) => r.m === m).length}</button>`).join('');
  $('#api-bps').innerHTML = [['all', `all ${ROUTES.length}`], ...BPS.map(([b]) => [b, `${b} ${ROUTES.filter((r) => r.bp === b).length}`])]
    .map(([b, l]) => `<button class="chip${b === 'all' ? ' on' : ''}" data-bp="${b}" aria-pressed="${b === 'all'}">${esc(l)}</button>`).join('');
  $$('#api-methods .chip').forEach((b) => {
    b.classList.add(`m-${b.dataset.m}`);
    b.addEventListener('click', () => {
      const m = b.dataset.m;
      mOn.has(m) ? mOn.delete(m) : mOn.add(m);
      if (!mOn.size) METHODS.forEach((x) => mOn.add(x));
      $$('#api-methods .chip').forEach((x) => { const on = mOn.has(x.dataset.m); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      renderApi();
    });
  });
  $$('#api-bps .chip').forEach((b) => b.addEventListener('click', () => {
    bpOn = b.dataset.bp;
    $$('#api-bps .chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    renderApi();
  }));
  const apiQ = $('#api-q');
  apiQ.addEventListener('input', renderApi);

  function pathHTML(p, q) {
    let s = esc(p);
    if (q && q.length > 1) {
      const i = p.toLowerCase().indexOf(q);
      if (i >= 0) s = `${esc(p.slice(0, i))}<mark>${esc(p.slice(i, i + q.length))}</mark>${esc(p.slice(i + q.length))}`;
    }
    return s.replace(/&lt;([^&]*?)&gt;/g, '<i>&lt;$1&gt;</i>');
  }
  function curl(r) {
    const url = `http://127.0.0.1:${PORT}${r.p}`;
    if (r.m === 'WS') return `ws://127.0.0.1:${PORT}${r.p}`;
    const qs = r.q && r.m === 'GET' ? `?${r.q.map((k) => `${k}=…`).join('&')}` : '';
    if (r.m === 'GET') return `curl -s '${url}${qs}'`;
    const body = r.b ? ` -H 'Content-Type: application/json' -d '{${r.b.map((k) => `"${k}": …`).join(', ')}}'` : '';
    return `curl -s -X ${r.m}${body} '${url}'`;
  }
  function renderApi() {
    const q = apiQ.value.trim().toLowerCase();
    const list = ROUTES.filter((r) => mOn.has(r.m) && (bpOn === 'all' || r.bp === bpOn) &&
      (!q || r.p.toLowerCase().includes(q) || r.f.toLowerCase().includes(q) || (r.d || '').toLowerCase().includes(q) || (r.q || []).some((x) => x.includes(q)) || (r.b || []).some((x) => x.includes(q))));
    $('#api-count').textContent = `${list.length} of ${ROUTES.length}`;
    if (!list.length) { $('#api-list').innerHTML = `<p class="api-empty">No route matches “${esc(q)}”.</p>`; return; }
    $('#api-list').innerHTML = BPS.filter(([b]) => list.some((r) => r.bp === b)).map(([b, desc]) => {
      const rows = list.filter((r) => r.bp === b);
      return `<div class="api-group"><div class="api-group-head"><h4>${b}<small>${rows.length}</small></h4><p>${esc(desc)}</p><a href="${REPO}/blob/main/server/api/${b}.py">server/api/${b}.py ↗</a></div>
        ${rows.map((r, i) => `<div class="route"><span class="m m-${r.m}">${r.m}</span>
          <div><span class="p">${pathHTML(r.p, q)}</span><span class="f">${esc(r.f)}()</span></div>
          <button class="copy" data-curl="${esc(curl(r))}" aria-label="Copy a curl for ${esc(r.m)} ${esc(r.p)}">${icon('copy')}</button>
          ${r.d ? `<div class="d">${esc(r.d)}</div>` : ''}
          ${r.q || r.b ? `<div class="args">${r.q ? `query ${r.q.map((x) => `<span>${esc(x)}</span>`).join('')}` : ''}${r.b ? ` body ${r.b.map((x) => `<span>${esc(x)}</span>`).join('')}` : ''}</div>` : ''}
        </div>`).join('')}</div>`;
    }).join('');
    $$('[data-curl]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await copyText(b.dataset.curl);
      toast(ok ? 'curl copied' : 'Copy failed');
    }));
  }
  renderApi();

  /* ── 11 · the layout tree ─────────────────────────────────────────────── */
  const F = (name, note, kids) => ({ name, note, kids });
  const TREE = F('Tubcal', 'The repository root: one Flask app, one React SPA, one SQLite file.', [
    F('main.py', 'The entry point: updater → init DB → create_app → warm caches → start the notifier, brain and edition workers → run on 127.0.0.1.'),
    F('server', 'The Flask backend.', [
      F('config.py', 'Env-driven configuration (every variable optional), cache TTLs, per-host request spacing, the room ids, EDITOR_ROOT.'),
      F('db.py', 'The one SQLite file: subscriptions, settings (key/value), watch history and progress, saved items, OAuth tokens, Archive transcripts and vectors, editions. All DB access goes through here — no ORM.'),
      F('cache.py', 'Two layers (memory + SQLite) with a TTL; cached(), cached_swr(), warm(), invalidate(). Expired rows are kept so a failed fetch can serve stale.'),
      F('httpc.py', 'Shared requests sessions, per-host minimum spacing, a large pool for HLS fan-out, and the cookie-less anonymous session.'),
      F('updater.py', 'Upgrades anipy-api from PyPI before anything imports it; best-effort, honours TUBCAL_AUTO_UPDATE=0.'),
      F('notifier.py', 'Polls upcoming subscribed streams and fires notify-send ~10 minutes before one goes live.'),
      F('api', 'The blueprints. Every response is ok(data) / err(msg).', [
        F('feeds.py', 'Feeds for every platform, YouTube streams and the synthesized HLS playlists, the segment proxy, history, progress, saved, search-everything.'),
        F('subscriptions.py', 'Follow/unfollow, and resolving pasted channels, subreddits and repos.'),
        F('settings.py', 'GET/PUT the settings table.'),
        F('oauth.py', 'Google, Reddit and AniList OAuth with plain requests; redirect URIs on 127.0.0.1.'),
        F('edition.py', 'The Edition: latest, back issues, status, rebuild.'),
        F('brain.py', 'The Archive: status, docs, search, ask, summarize, digest.'),
        F('editor.py', 'The Composing Room. Every path goes through _safe(): resolved against EDITOR_ROOT, escapes rejected; atomic writes with an mtime precondition.'),
        F('dev.py', 'The Workbench shelves, one endpoint each.'),
        F('anime.py', 'The Anime: AniList reads/writes, social, reviews, schedule, finale, episodes and stream proxying.'),
      ]),
      F('sources', 'One module per platform’s quirks.', [
        F('youtube.py', 'RSS for subscriptions, search routing (InnerTube first, Invidious fallback), stream resolution via yt-dlp, the quality ladder, video metadata, The Projection.'),
        F('innertube.py', 'YouTube’s own youtubei/v1/search — one unauthenticated POST, continuation-token pagination.'),
        F('invidious.py', 'Trending, comments, and the search fallback across public instances.'),
        F('fmp4.py', 'Parses a DASH rendition’s sidx box into byte-range segments for the synthesized HLS.'),
        F('reddit.py', 'RSS when anonymous, JSON with OAuth; threaded comments.'),
        F('hackernews.py', 'Firebase API + Algolia search. The reference shape for a source: normalize / get_feed / search / get_item, each cached.'),
        F('github.py', 'Public REST API — repos, releases, activity, trending; cached hard for the 60/hr limit.'),
        F('anilist.py', 'GraphQL: media, lists, social, stats, the relation walks behind the sequel radar and watch-order guide, and the 30/min budget.'),
        F('anime_source.py', 'Episode lists and streams through anipy-api (allanime/animekai); marks episodes watched on AniList past the threshold.'),
        F('weeb_fallback.py', 'The second scraper (weeb-cli’s aniworld provider), same return shape.'),
        F('dev.py', 'The Workbench’s language registry — adding a language is adding one dict — plus a namespace-agnostic RSS/Atom parser.'),
        F('fuzzy.py', 'rapidfuzz over cached feed items: a fallback when a platform’s own search returns little.'),
        F('mixer.py', 'Deterministic weighted round-robin that interleaves platforms into one feed.'),
      ]),
      F('brain', 'The Archive and The Edition.', [
        F('transcribe.py', 'faster-whisper, loaded lazily; int8 on CPU, float16 on CUDA.'),
        F('search.py', 'Brute-force cosine over every chunk vector in SQLite; doc-scoped ranking for the Edition’s lede.'),
        F('summarize.py', 'TL;DRs and the two-stage ask (zoom pass + re-read with neighbouring chunks).'),
        F('llm.py', 'Ollama over plain HTTP — no client library.'),
        F('worker.py', 'The background indexer: transcribe → chunk → embed.'),
        F('cluster.py', 'Pure functions: canonical-URL hard links, greedy centroid clustering, salience, layout. The deepest test coverage.'),
        F('feed_index.py', 'Collects recent feed items and their embeddings for the Edition.'),
        F('edition.py', 'The daily builder: the degradation ladder, capped and time-boxed synthesis, the citation validator.'),
      ]),
      F('editor', 'Sockets for the Composing Room (flask-sock).', [
        F('terminal.py', 'The PTY terminal.'),
        F('lsp.py', 'stdio JSON-RPC ⇄ plain-JSON WebSocket frames; probes which language servers really run.'),
        F('sockets.py', 'Registers /api/editor/pty and /api/editor/lsp when flask-sock is installed.'),
      ]),
    ]),
    F('frontend', 'React 19 + Vite.', [
      F('src', 'The SPA.', [
        F('App.jsx', 'Routes: the chooser, the hub rooms under HubLayout, the Anime under AnimeSection — all lazy-loaded.'),
        F('state.jsx', 'Shared state as a stack of context providers: settings, subscriptions, player, progress, saved, anime sync.'),
        F('api', 'client.js — api() / useApi(), unwrapping the envelope.', [F('client.js', 'Unwraps { ok, data } or throws on ok === false.')]),
        F('lib', 'Registries and hooks.', [
          F('rooms.js', 'The canonical room registry — the source of the numbering.'),
          F('themes.js', 'The skin registry.'),
          F('urlState.js', 'View state in the URL (useParamState), so Back restores it.'),
          F('skinFonts.js', 'Loads a skin’s fonts only when it’s selected.'),
        ]),
        F('pages', 'One lazy-loaded page per room, plus the chooser and the anime pages.'),
        F('components', 'The pieces.', [
          F('layout', 'The hub console, command palette, keyboard nav.'),
          F('player', 'The global player, its controls and programme notes.'),
          F('screening', 'Video tiles, shelves, the Screening Room’s index.'),
          F('wire', 'The HN reader.'),
          F('anime', 'Every view of the Anime channel, the Reckoner, the curtain call.'),
          F('editor', 'The Composing Room: CodeMirror theme from tokens, which-key, terminal.'),
        ]),
        F('styles', 'tokens.css (Shōwa Night/Day), themes.css (the other five skins), backdrop.css, base.css.'),
      ]),
    ]),
    F('tests', 'pytest, against a throwaway database. Deepest where a bug would be silent: clustering, path containment, fMP4, anonymous reads, AniList helpers.'),
    F('docs', 'This site — plain HTML/CSS/JS for GitHub Pages — and docs/tools/extract_routes.py, which regenerates the API reference.'),
    F('data', 'Git-ignored. tubcal.db (everything) and .bak-* snapshots.', [F('tubcal.db', 'Everything local, in one file.')]),
    F('pyproject.toml', 'Dependencies, and the brain / editor extras.'),
  ]);
  const NOLINK = new Set(['data', 'data/tubcal.db']);
  const ftree = $('#ftree');
  const fnote = $('#fnote');
  let fid = 0;
  const byId = {};
  function treeHTML(node, path, depth) {
    const id = `fn${fid++}`;
    byId[id] = { node, path };
    const dir = !!node.kids;
    const open = depth < 1 || path === 'server';
    return `<div role="treeitem" aria-expanded="${dir ? open : ''}"><button class="fnode${dir ? ' dir' : ''}" data-id="${id}" ${dir ? `aria-expanded="${open}"` : ''}>
      <span class="tw">${dir ? '▸' : ''}</span>${icon(dir ? 'folder' : 'file')}<span>${esc(node.name)}${dir ? '/' : ''}</span></button>
      ${dir ? `<div class="fkids" role="group" ${open ? '' : 'hidden'}>${node.kids.map((k) => treeHTML(k, path ? `${path}/${k.name}` : k.name, depth + 1)).join('')}</div>` : ''}</div>`;
  }
  ftree.innerHTML = TREE.kids.map((k) => treeHTML(k, k.name, 0)).join('');
  function showNote(id) {
    const { node, path } = byId[id];
    $$('.fnode', ftree).forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const url = node.kids ? `${REPO}/tree/main/${path}` : `${REPO}/blob/main/${path}`;
    fnote.innerHTML = `<span class="kicker">${esc(path)}${node.kids ? '/' : ''}</span><h4>${esc(node.name)}</h4><p>${esc(node.note)}</p>${NOLINK.has(path) ? '<p class="dim" style="margin-top:10px">Not in the repository — created on first run.</p>' : `<a href="${url}">${icon('github')}View on GitHub</a>`}`;
  }
  $$('.fnode', ftree).forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('dir')) {
      const kids = b.nextElementSibling;
      const open = kids.hidden;
      kids.hidden = !open;
      b.setAttribute('aria-expanded', open);
    }
    showNote(b.dataset.id);
  }));
  fnote.innerHTML = `<span class="kicker">github.com/Shio-T0/Tubcal</span><h4>Tubcal/</h4><p>${esc(TREE.note)} Pick a folder or a file on the left.</p>`;

  window.TC.wireCopyButtons();
})();
