/* The Tour — the demos. Everything here is a small, faithful model of how the
   app behaves (numbering by running order, the Edition's ladder, the player's
   keys and dock, the Reckoner's aired-so-far cap), drawn with invented sample
   content. */

(function () {
  'use strict';
  const { $, $$, esc, icon, toast, copyText } = window.TC;
  const T = window.TUBCAL;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmt = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  /* ════════════════════════════════════════════════════════════════════ *
   * The bar, the chooser's programme guide, the route wall
   * ════════════════════════════════════════════════════════════════════ */
  const STOP_C = { hub: 'var(--signal)', edition: 'var(--c-foryou)', player: 'var(--c-youtube)', anime: 'var(--accent-strong)', look: 'var(--rail-3)', privacy: 'var(--c-dev)', 'tune-in': 'var(--signal)' };
  const stops = T.tour.filter((s) => s.id !== 'top');

  $('#bar-stops').innerHTML = stops.map((s) => `<a href="#${s.id}" data-stop="${s.id}" style="--stop-c:${STOP_C[s.id]}">${esc(s.title.replace('Channel 1 · ', '').replace('Channel 2 · ', ''))}</a>`).join('');
  $('#guide').innerHTML = stops
    .map((s, i) => `<a class="gitem" href="#${s.id}" style="--room-c:${STOP_C[s.id]};--i:${i}"><small>No ${String(i + 1).padStart(2, '0')}</small><b>${esc(s.title.replace('Channel 1 · ', '').replace('Channel 2 · ', ''))}</b></a>`)
    .join('');

  const routes = window.TUBCAL_ROUTES || [];
  if (routes.length) {
    const http = routes.filter((r) => r.m !== 'WS').length;
    $('#route-count').textContent = `${http} routes + 2 sockets documented`;
    const pick = routes.slice().sort(() => 0.5 - Math.random()).slice(0, 64);
    $('#routewall').innerHTML = pick.map((r) => `<span><b>${r.m}</b>${esc(r.p)}</span>`).join('');
  }

  const bar = $('#bar');
  const chooser = $('#top');
  const stopLinks = $$('#bar-stops a');
  function onScroll() {
    const past = chooser.getBoundingClientRect().bottom < 80;
    bar.classList.toggle('show', past);
    let cur = null;
    stops.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.4) cur = s.id;
    });
    stopLinks.forEach((a) => a.classList.toggle('on', a.dataset.stop === cur));
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ════════════════════════════════════════════════════════════════════ *
   * 01 · The Hub — console, room screens, Settings → Rooms
   * ════════════════════════════════════════════════════════════════════ */
  const today = new Date();
  const shortDate = today.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const hue = (d) => ` style="filter:hue-rotate(${d}deg)"`;
  const L = (w) => `<span class="ln ${w}"></span>`;

  const MOCKS = {
    edition: () => `
      <div class="mock">
        <div class="mk-ed-plate"><span>No 214 · edited</span><b>The Edition</b><span>${esc(shortDate)}</span></div>
        <div class="mk-ed-grid">
          <div class="mk-ed-lede"><div class="pic"></div><span class="mk-k">The Wire · kestrel.dev</span>
            <h5>Kestrel 2.0 lands with offline sync</h5>${L('f')}${L('f')}${L('m')}</div>
          <div class="mk-ed-rail"><span class="mk-k">Screening Room</span><h6>Every CRT test pattern, drawn by hand</h6>${L('f')}${L('s')}
            <span class="mk-k">The Dispatch</span><h6>A wood-cabinet set, found on the curb, still glows</h6>${L('m')}</div>
        </div>
        <div class="mk-ed-brief">
          <div><span class="mk-k">In brief · Wire</span>${L('f')}${L('m')}</div>
          <div><span class="mk-k">Screening Room</span>${L('f')}${L('s')}</div>
          <div><span class="mk-k">The Dispatch</span>${L('m')}${L('f')}</div>
        </div>
      </div>`,
    youtube: () => `
      <div class="mock">
        <div class="mk-yt-top">
          <div class="pic mk-yt-big"><span class="mk-yt-live">NEW · 2h</span></div>
          <div><span class="mk-k">Just in</span>
            ${[20, 60, 140, 220].map((h) => `<div class="mk-yt-row"><div class="pic"${hue(h)}></div><div>${L('f')}${L('s')}</div></div>`).join('')}
          </div>
        </div>
        <div class="mk-yt-shelf"><span class="mk-k">The Projection · from your history</span>
          <div class="mk-yt-tiles">${[0, 40, 90, 180, 260].map((h) => `<div class="pic"${hue(h)}></div>`).join('')}</div></div>
        <div class="mk-yt-shelf"><span class="mk-k">The Phosphor Lab <span class="mk-new">3 new</span></span>
          <div class="mk-yt-tiles">${[300, 330, 20, 70, 120].map((h) => `<div class="pic"${hue(h)}></div>`).join('')}</div></div>
      </div>`,
    reddit: () => `
      <div class="mock">
        <div class="mk-rd-head"><b>The Dispatch</b><span class="mk-meta">r/selfhosted · r/rust · r/crtgaming</span></div>
        <div class="mk-rd-cols">
          <div><span class="mk-k">r/selfhosted</span><h5>I replaced four apps with one localhost page — a year in</h5>
            <span class="mk-meta">1.2k points · 214 comments · 5h</span>${L('f')}${L('f')}${L('m')}${L('f')}${L('s')}</div>
          <div><span class="mk-k">r/rust</span><h6>Arena allocators, explained with index cards</h6><span class="mk-meta">412 · 88 comments</span>${L('f')}${L('s')}${L('m')}</div>
          <div><span class="mk-k">r/crtgaming</span><h6>Found a wood-cabinet set on the curb. It still glows.</h6><span class="mk-meta">2.4k · 131</span>${L('m')}${L('f')}</div>
        </div>
      </div>`,
    hackernews: () => {
      const rows = [
        ['Kestrel 2.0: offline sync is finally here', 'kestrel.dev', 92, '188', '+14', ''],
        ['Show HN: A teletype-style reader for the terminal', 'github.com', 71, '64', '+3', ''],
        ['Ask HN: What’s your most-used shell alias?', '', 58, '301', '+22', ''],
        ['Why one file beats a database server for personal apps', 'example.org', 64, '142', '', 'read'],
        ['How phosphor persistence shaped early interface design', 'example.com', 38, '57', '', 'read'],
        ['A field guide to rate limits you didn’t know you had', 'example.net', 47, '96', '+5', ''],
      ];
      return `<div class="mock">
        <div class="mk-hn-tabs"><span>Top</span><span>Best</span><span>New</span><span>Ask</span><span>Show</span><span>Jobs</span></div>
        ${rows.map((r, i) => `<div class="mk-hn-row ${r[5]}"><span class="rk">${i + 1}.</span><span class="hl">${esc(r[0])}${r[1] ? `<i>${r[1]}</i>` : ''}</span><span class="mk-heat" style="--h:${r[2]}%"></span><span class="cm">${r[3]}${r[4] ? ` <b>${r[4]}</b>` : ''}</span></div>`).join('')}
      </div>`;
    },
    archive: () => `
      <div class="mock">
        <div class="mk-ar-q">What did that talk say about arena allocators?</div>
        <div class="mk-ar-ans"><span class="mk-k">Answer · local model · 2 passes</span>${L('f')}${L('f')}${L('m')}${L('f')}${L('s')}
          <div class="mk-cites"><span class="x">[1] Arenas in practice · 12:40</span><span class="x">[2] · 31:05</span><span>[3] · 4:18</span><span>[4] · 22:51</span></div></div>
        <div class="mk-ar-stat"><span><b>142</b> videos transcribed</span><span><b>6,120</b> chunks</span><span><b>0</b> bytes sent anywhere</span></div>
      </div>`,
    editor: () => `
      <div class="mock mk-ed2">
        <div class="mk-tabs"><span class="on">main.rs</span><span>lib.rs</span><span>Cargo.toml</span></div>
        <div class="mk-tree">▾ src<br>&nbsp;&nbsp;<span class="on">main.rs</span><br>&nbsp;&nbsp;lib.rs<br>▸ tests<br>Cargo.toml<br>README.md</div>
        <div class="mk-buf"><span class="n">1</span><span class="kw">use</span> lantern::Tide;
<span class="n">2</span>
<span class="n">3</span><span class="kw">fn</span> main() {
<span class="n">4</span><span class="gg"></span>    <span class="kw">let</span> tide = Tide::new(<span class="st">"low"</span>);
<span class="n">5</span><span class="gg"></span>    tide.<span class="cu">l</span>ight();
<span class="n">6</span>}
          <div class="mk-wk"><b>leader</b> f find file<br><b>leader</b> s search project<br><b>leader</b> t toggle terminal<br><b>leader</b> w write buffer</div></div>
        <div class="mk-status"><b>NORMAL</b><span>⎇ main</span><span>src/main.rs</span><span style="margin-left:auto">5:10</span></div>
        <div class="mk-term"><b>~/Projects/lantern $</b> cargo test · 14 passed</div>
      </div>`,
    github: () => `
      <div class="mock">
        <span class="mk-k">Followed · releases &amp; activity</span>
        ${[['lantern-org/lantern', 'v0.9.0', 'released 2h ago'], ['quiet/tide-cli', 'v2.3.1', 'released yesterday'], ['you/dotfiles', '12 commits', 'this week'], ['phosphor/testcard', 'v1.0.0', 'released 3d ago'], ['kestrel/kestrel', 'v2.0.0', 'released 6h ago']]
          .map((r) => `<div class="mk-gh-row"><span class="av"></span><span><b>${r[0]}</b><br><span class="mk-meta">${r[2]}</span></span><span class="mk-tag">${r[1]}</span></div>`).join('')}
      </div>`,
    dev: () => `
      <div class="mock">
        <div class="mk-wb-tabs"><span class="on">Rust</span><span>Python</span><span>Go</span><span>TypeScript</span></div>
        <div class="mk-wb-sheet">
          <span class="mk-wb-stamp">current stable · checked live</span>
          <span class="mk-k">Service manual No 1</span><h5>Rust</h5>
          <div class="mk-wb-grid">
            <div><span class="mk-k">Bench radio</span><div class="mk-radio">▶<i></i></div>${L('f')}${L('s')}</div>
            <div><span class="mk-k">Trending repos</span>
              <div class="mk-repo"><span>tide-rs</span><b>★ 1.2k</b></div><div class="mk-repo"><span>lantern</span><b>★ 840</b></div><div class="mk-repo"><span>arena-kit</span><b>★ 512</b></div></div>
          </div>
          <span class="mk-k" style="display:block;margin-top:8px">Core-team updates</span>${L('f')}${L('m')}
        </div>
      </div>`,
  };

  const active = new Set(T.rooms.filter((r) => r.on).map((r) => r.id));
  let current = 'edition';
  const nav = $('#con-nav');
  const screen = $('#roomscreen');

  function runningOrder() {
    return T.rooms.filter((r) => active.has(r.id));
  }
  function renderNav() {
    const list = runningOrder();
    if (!list.find((r) => r.id === current) && list.length) current = list[0].id;
    nav.innerHTML = list
      .map((r, i) => `<button class="tc-navitem${r.id === current ? ' tc-navitem-on' : ''}" role="tab" aria-selected="${r.id === current}" data-room="${r.id}" style="--room-c:${r.color};animation-delay:${i * 30}ms" tabindex="${r.id === current ? 0 : -1}">
          <span class="tc-navno">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(r.label)}</span></button>`)
      .join('') || '<p class="muted" style="padding:6px 8px;font-size:13px">Every room is switched off. The console waits.</p>';
    $$('.tc-navitem', nav).forEach((b) => {
      b.addEventListener('click', () => selectRoom(b.dataset.room, true));
    });
  }
  function renderScreen(tune) {
    const list = runningOrder();
    const idx = list.findIndex((r) => r.id === current);
    const r = T.rooms.find((x) => x.id === current);
    if (!r || idx < 0) {
      screen.innerHTML = '<div class="rs-copy"><h3>Nothing on air.</h3><p class="dim">Switch a room back on below.</p></div>';
      return;
    }
    screen.style.setProperty('--room-c', r.color);
    screen.innerHTML = `
      <div class="rs-glass"><div class="rs-tube${tune && !reduce ? ' tuning' : ''}">${MOCKS[r.id]()}<span class="scan" aria-hidden="true"></span></div></div>
      <div class="rs-copy">
        <div class="rs-kicker"><span class="rs-no">No ${String(idx + 1).padStart(2, '0')}</span><span>${esc(r.route)}</span>${r.chord ? `<span>in the app: <kbd>g</kbd><kbd>${r.chord}</kbd></span>` : ''}</div>
        <h3>${esc(r.label)}</h3>
        <p class="rs-line">${esc(r.line)}</p>
        <p>${esc(r.body)}</p>
        <ul class="rs-tags">${r.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>`;
    fitMock();
  }
  // the mocks are drawn at 440×304 and scaled to whatever tube they sit in
  function fitMock() {
    const tube = $('.rs-tube', screen);
    const mock = tube && $('.mock', tube);
    if (!mock) return;
    const s = tube.clientWidth / 440;
    mock.style.setProperty('--mk-s', s.toFixed(4));
    mock.style.height = `${tube.clientHeight / s}px`;
  }
  addEventListener('resize', fitMock);
  function selectRoom(id, focus) {
    current = id;
    renderNav();
    renderScreen(true);
    if (focus) { const b = $(`.tc-navitem[data-room="${id}"]`, nav); if (b) b.focus({ preventScroll: true }); }
  }
  nav.addEventListener('keydown', (e) => {
    const keys = { ArrowDown: 1, ArrowRight: 1, j: 1, ArrowUp: -1, ArrowLeft: -1, k: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    e.stopPropagation();
    const list = runningOrder();
    const i = list.findIndex((r) => r.id === current);
    selectRoom(list[(i + keys[e.key] + list.length) % list.length].id, true);
  });
  // j/k inside the console should move the rooms, not the page
  nav.setAttribute('data-owns-keys', '');

  function renderToggles() {
    const order = runningOrder().map((r) => r.id);
    $('#sr-grid').innerHTML = T.rooms
      .map((r) => {
        const on = active.has(r.id);
        const n = on ? String(order.indexOf(r.id) + 1).padStart(2, '0') : '—';
        return `<label class="sr-item${on ? '' : ' off'}"><span class="sr-no">${n}</span><span class="sr-name">${esc(r.label)}</span>
          <span class="switch" style="--sw-c:${r.color}"><input type="checkbox" data-toggle="${r.id}" ${on ? 'checked' : ''} aria-label="${esc(r.label)}"><span class="track"></span></span></label>`;
      })
      .join('');
    $$('[data-toggle]').forEach((cb) =>
      cb.addEventListener('change', () => {
        cb.checked ? active.add(cb.dataset.toggle) : active.delete(cb.dataset.toggle);
        if (cb.checked) current = cb.dataset.toggle;
        renderToggles();
        renderNav();
        renderScreen(true);
        const n = runningOrder().length;
        toast(cb.checked ? `${T.rooms.find((r) => r.id === cb.dataset.toggle).label} on · ${n} rooms` : `Renumbered · ${n} rooms`);
      }),
    );
  }
  document.addEventListener('tubcal:room', (e) => {
    if (!active.has(e.detail)) { active.add(e.detail); renderToggles(); }
    selectRoom(e.detail, false);
  });
  renderNav();
  renderScreen(false);
  renderToggles();

  /* ════════════════════════════════════════════════════════════════════ *
   * 02 · The Edition — the ladder
   * ════════════════════════════════════════════════════════════════════ */
  const SRC = {
    wire: { name: 'The Wire', c: 'var(--c-hn)' },
    dispatch: { name: 'The Dispatch', c: 'var(--c-reddit)' },
    screening: { name: 'Screening Room', c: 'var(--c-youtube)' },
  };
  const ITEMS = {
    A: { room: 'wire', title: 'Kestrel 2.0: offline sync is finally here', nums: ['412 points', '188 comments', '6h', 'kestrel.dev'] },
    B: { room: 'dispatch', title: 'Kestrel 2.0 is out — offline sync finally landed', nums: ['1.2k points', '214 comments', '5h', 'r/selfhosted'] },
    C: { room: 'screening', title: 'Kestrel 2.0 in twelve minutes: what offline sync changes', nums: ['38K views', '5h', 'Local-First Weekly'], video: true },
    D: { room: 'screening', title: 'Every CRT test pattern, drawn by hand', nums: ['91K views', '1d', 'The Phosphor Lab'], video: true },
    E: { room: 'wire', title: 'Ask HN: What’s your most-used shell alias?', nums: ['233 points', '301 comments', '9h'] },
  };
  const WRITTEN = {
    lede3: {
      h: 'Kestrel 2.0 lands with offline sync',
      dek: 'The release topped the Wire, reached the Dispatch and got a twelve-minute walkthrough in the Screening Room.',
      body: 'Kestrel’s new major version adds offline sync. On the Wire it drew 412 points and 188 comments [1]; on r/selfhosted, 1.2k points [2]; and a Local-First Weekly video walks through what the sync changes in twelve minutes [3].',
    },
    lede2: {
      h: 'Kestrel 2.0 lands with offline sync',
      dek: 'The release topped the Wire and reached the Dispatch within hours.',
      body: 'Kestrel’s new major version adds offline sync. On the Wire it drew 412 points and 188 comments [1]; on r/selfhosted, the same link reached 1.2k points [2].',
    },
    C: { h: 'Twelve minutes on Kestrel’s new sync', dek: 'Local-First Weekly walks through what changes in 2.0 [1].' },
    D: { h: 'Every CRT test pattern, drawn by hand', dek: 'The Phosphor Lab’s new video catalogues the calibration cards [1].' },
    E: { h: 'Readers trade the shell aliases they can’t live without', dek: 'An Ask HN thread passed 300 comments overnight [1].' },
  };
  const BRIEFS = [
    ['Screening Room', 'A synth built from a 1970s radio chassis', 'Three new uploads from channels you follow'],
    ['The Dispatch', 'r/crtgaming: a wood-cabinet set, found on the curb, still glows', 'r/rust: arena allocators, with index cards'],
    ['The Wire', 'Show HN: a teletype-style reader for the terminal', 'Why one file beats a database server'],
  ];

  const emb = $('#lad-embed');
  const chat = $('#lad-chat');
  const paper = $('#paper');
  let lastLedeSize = 2;

  const chip = (k, joined) => `<span class="np-src${joined ? ' joined' : ''}" style="--src-c:${SRC[ITEMS[k].room].c}">${SRC[ITEMS[k].room].name}</span>`;
  const nums = (k) => `<div class="np-numbers">${ITEMS[k].nums.map((n, i) => (i === 0 ? `<b>${esc(n)}</b>` : `<span>${esc(n)}</span>`)).join('')}</div>`;
  const cites = (s) => esc(s).replace(/\[(\d)\]/g, '<span class="cite">$1</span>');

  function renderPaper(animate) {
    const e = emb.checked, c = chat.checked;
    const lede = e ? ['A', 'B', 'C'] : ['A', 'B'];
    const rail = e ? ['D', 'E'] : ['C', 'D'];
    const hasVideo = lede.some((k) => ITEMS[k].video);
    const joinedNow = e && lastLedeSize < 3;
    lastLedeSize = lede.length;
    const W = c ? (e ? WRITTEN.lede3 : WRITTEN.lede2) : null;
    const status = c ? 'edited' : 'wire';

    $$('#rungs li').forEach((li) => {
      const r = +li.dataset.rung;
      li.classList.toggle('lit', r === 0 || (r === 1 && e) || (r === 2 && c));
    });
    $('#ladder-note').innerHTML = c
      ? `Status <b>edited</b>. At most six stories get the copy desk per build; anything unvalidated falls back to the template.`
      : e
        ? `Status <b>wire</b> — but the embed model found the video about the same story and pulled it into the lede.`
        : `Status <b>wire</b>. No ML at all: stories cluster only when they link the same canonical URL, and every story shows its numbers.`;

    paper.classList.toggle('setting', !!animate && !reduce);
    paper.innerHTML = `
      <div class="np-plate">
        <div class="np-ear">No 214<br>${esc(today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <div class="np-name">The Edition</div>
        <div class="np-ear">3 rooms · 36 h<br><span class="np-status">${status}</span></div>
      </div>
      <div class="np-grid">
        <article class="np-lede">
          ${hasVideo ? '<div class="np-pic" aria-hidden="true"></div>' : ''}
          <span class="np-kick">The Wire · kestrel.dev</span>
          <h4>${esc(W ? W.h : ITEMS.A.title)}</h4>
          ${W ? `<p class="np-dek">${esc(W.dek)}</p><p class="np-body">${cites(W.body)}</p>` : nums('A')}
          <div class="np-sources">${lede.map((k) => chip(k, joinedNow && k === 'C')).join('')}</div>
        </article>
        <div class="np-rail">
          ${rail.map((k) => `<article><span class="np-kick" style="color:${SRC[ITEMS[k].room].c}">${SRC[ITEMS[k].room].name}</span>
              <h5>${esc(c ? WRITTEN[k].h : ITEMS[k].title)}</h5>${c ? `<p>${cites(WRITTEN[k].dek)}</p>` : nums(k)}</article>`).join('')}
        </div>
      </div>
      <div class="np-brief">${BRIEFS.map((b) => `<div><h6>In brief · ${b[0]}</h6><p>${esc(b[1])}</p><p>${esc(b[2])}</p></div>`).join('')}</div>
      ${c ? `<span class="np-stamp">✓ citations checked · ${lede.length}/${lede.length}</span>` : ''}`;
  }
  emb.addEventListener('change', () => renderPaper(true));
  chat.addEventListener('change', () => renderPaper(true));
  renderPaper(false);

  /* ════════════════════════════════════════════════════════════════════ *
   * 03 · The player
   * ════════════════════════════════════════════════════════════════════ */
  const DUR = 1120;
  const CHAPTERS = [
    { t: 0, name: 'The tube', c: '#c4503a' },
    { t: 110, name: 'The electron gun', c: '#e6ab5e' },
    { t: 270, name: 'Phosphor', c: '#9aae64' },
    { t: 460, name: 'The raster', c: '#4f9ec4' },
    { t: 680, name: 'Interlacing', c: '#9a8ec7' },
    { t: 900, name: 'Colour: the shadow mask', c: '#cf7733' },
  ];
  const LINES = [
    [5, 'A cathode-ray tube is a vacuum bottle with a gun at the narrow end and a screen at the wide one.'],
    [112, 'The gun boils electrons off a heated cathode and accelerates them toward the screen.'],
    [190, 'Coils around the neck of the tube steer the beam — that’s the deflection yoke.'],
    [272, 'Wherever the beam lands, a phosphor coating glows for a moment.'],
    [365, 'The glow fades quickly, so the beam has to come back many times a second.'],
    [462, 'The beam sweeps left to right, line by line, top to bottom: the raster.'],
    [570, 'Each trip back to the left is blanked, so you never see the retrace.'],
    [682, 'Interlacing draws the odd lines, then the even ones, to halve the flicker.'],
    [820, 'Two fields make one frame — a bandwidth trick that lasted for decades.'],
    [902, 'Colour tubes fire three beams through a shadow mask onto red, green and blue dots.'],
    [1030, 'Stand back far enough, and the dots blend into a picture.'],
  ];
  const chapEnd = (i) => (i < CHAPTERS.length - 1 ? CHAPTERS[i + 1].t : DUR);
  const chapAt = (t) => { let i = 0; CHAPTERS.forEach((c, k) => { if (t >= c.t) i = k; }); return i; };

  // "most replayed": a seeded ridge with peaks where people rewatch
  const HEAT = (() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const peaks = [[285, 0.95, 40], [700, 0.7, 50], [915, 0.8, 45], [20, 0.45, 30]];
    const out = [];
    for (let i = 0; i < 100; i++) {
      const t = (i / 99) * DUR;
      let v = 0.12 + rnd() * 0.12;
      peaks.forEach(([p, h, w]) => { v += h * Math.exp(-((t - p) ** 2) / (2 * w * w)); });
      out.push(v);
    }
    const max = Math.max(...out);
    return out.map((v) => v / max);
  })();
  (function drawRidge() {
    let d = 'M0,40';
    HEAT.forEach((v, i) => {
      const x = (i / (HEAT.length - 1)) * 1000;
      d += ` L${x.toFixed(1)},${(40 - v * 36).toFixed(1)}`;
    });
    d += ' L1000,40 Z';
    $('#th-ridge').innerHTML = `<path d="${d}"/>`;
  })();

  const th = {
    t: 0, playing: false, rate: 1, vol: 0.8, muted: false, captions: false, docked: false, last: 0,
    card: $('#th-card'), stage: $('#th-stage'), theatre: $('#theatre'),
    bar: $('#th-bar'), seek: $('#th-seek'), tip: $('#th-tip'), osd: $('#th-osd'), scene: $('#th-scene'),
  };
  th.bar.innerHTML = CHAPTERS.map((c, i) => `<div class="sg" style="flex:${chapEnd(i) - c.t} 1 0"><i></i></div>`).join('') + '<span class="knob"></span>';
  const segs = $$('.sg', th.bar);
  const knob = $('.knob', th.bar);

  $('#th-pane-chapters').innerHTML = CHAPTERS.map((c, i) => `<button class="th-chapter" data-t="${c.t}" data-i="${i}"><span>${fmt(c.t)}</span><span>${esc(c.name)}</span></button>`).join('');
  $('#th-pane-transcript').innerHTML = LINES.map(([t, s], i) => `<button class="th-line" data-t="${t}" data-i="${i}"><span>${fmt(t)}</span><span>${esc(s)}</span></button>`).join('');
  const KEYROWS = [
    ['toggle', 'Play · pause', ['Space', 'K']],
    ['back10', 'Back / forward 10 s', ['J', 'L']],
    ['back5', 'Back / forward 5 s', ['←', '→']],
    ['chap', 'Previous · next chapter', ['Ctrl', '← →']],
    ['pct', 'Jump to 0–90 %', ['0', '–', '9']],
    ['vol', 'Volume · mute', ['↑', '↓', 'M']],
    ['rate', 'Slower · faster', ['<', '>']],
    ['full', 'Fullscreen · captions', ['F', 'C']],
    ['next', 'Next in Up next', ['Shift', 'N']],
    ['dock', 'Keep playing in the corner', ['Esc']],
    ['help', 'This list', ['?']],
  ];
  $('#th-pane-keys').innerHTML = KEYROWS.map(([id, label, keys]) => `<div class="th-key" data-k="${id}"><span>${label}</span><span>${keys.map((k) => (k === '–' ? '–' : `<kbd>${k}</kbd>`)).join('')}</span></div>`).join('');

  function setTab(name) {
    $$('.th-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
    ['chapters', 'transcript', 'keys'].forEach((n) => { $(`#th-pane-${n}`).hidden = n !== name; });
  }
  $$('.th-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  const SCENE_ART = [
    '<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 40 L58 18 L112 8 L112 72 L58 62 Z"/><circle cx="14" cy="40" r="4"/></svg>',
    '<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="32" width="26" height="16" rx="3"/><path d="M32 40 H112" stroke-dasharray="4 5"/><circle cx="112" cy="40" r="4" fill="currentColor"/></svg>',
    '<svg viewBox="0 0 120 80" fill="currentColor">' + Array.from({ length: 40 }, (_, i) => `<circle cx="${10 + (i % 10) * 11}" cy="${14 + Math.floor(i / 10) * 17}" r="${2 + ((i * 7) % 5) / 2}" opacity="${0.3 + ((i * 13) % 7) / 10}"/>`).join('') + '</svg>',
    '<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="1.6">' + Array.from({ length: 8 }, (_, i) => `<path d="M8 ${10 + i * 9} H112"/><path d="M112 ${10 + i * 9} L8 ${14 + i * 9}" stroke-dasharray="2 4" opacity=".45"/>`).join('') + '</svg>',
    '<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2">' + Array.from({ length: 8 }, (_, i) => `<path d="M8 ${10 + i * 9} H112" opacity="${i % 2 ? 0.3 : 1}"/>`).join('') + '</svg>',
    '<svg viewBox="0 0 120 80">' + Array.from({ length: 30 }, (_, i) => `<circle cx="${12 + (i % 10) * 10.5}" cy="${16 + Math.floor(i / 10) * 22 + (i % 2) * 6}" r="4" fill="${['#ff4d4d', '#4dff88', '#4d8bff'][i % 3]}"/>`).join('') + '</svg>',
  ];
  let sceneIdx = -1;
  function paintScene(i) {
    if (i === sceneIdx) return;
    sceneIdx = i;
    const c = CHAPTERS[i];
    th.card.style.setProperty('--ch-c', c.c);
    th.scene.innerHTML = `${SCENE_ART[i]}<span class="no">Chapter ${i + 1} of ${CHAPTERS.length}</span><span class="nm">${esc(c.name)}</span><span class="cap" id="th-cap" hidden></span>`;
    $('#th-chap').textContent = c.name;
    $$('.th-chapter').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
  }

  function knobX(t) {
    const i = chapAt(t);
    const s = segs[i];
    const f = (t - CHAPTERS[i].t) / (chapEnd(i) - CHAPTERS[i].t);
    return s.offsetLeft + f * s.offsetWidth;
  }
  function timeAtX(x) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (x <= s.offsetLeft + s.offsetWidth + 1.5 || i === segs.length - 1) {
        const f = Math.max(0, Math.min(1, (x - s.offsetLeft) / s.offsetWidth));
        return CHAPTERS[i].t + f * (chapEnd(i) - CHAPTERS[i].t);
      }
    }
    return 0;
  }
  let lastLine = -1;
  function paint() {
    const t = th.t;
    segs.forEach((s, i) => {
      const a = CHAPTERS[i].t, b = chapEnd(i);
      s.firstChild.style.width = `${Math.max(0, Math.min(1, (t - a) / (b - a))) * 100}%`;
    });
    knob.style.left = `${knobX(t)}px`;
    $('#th-time').textContent = `${fmt(t)} / ${fmt(DUR)}`;
    $('#th-at').textContent = fmt(t);
    th.seek.setAttribute('aria-valuenow', Math.round(t));
    th.seek.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(DUR)}`);
    paintScene(chapAt(t));
    let li = -1;
    LINES.forEach(([lt], i) => { if (t >= lt) li = i; });
    if (li !== lastLine) {
      lastLine = li;
      $$('.th-line').forEach((b) => b.classList.toggle('on', +b.dataset.i === li));
      const on = $(`.th-line[data-i="${li}"]`);
      const pane = $('#th-pane-transcript');
      if (on && !pane.hidden) pane.scrollTo({ top: on.offsetTop - pane.clientHeight / 2 + on.offsetHeight / 2, behavior: reduce ? 'auto' : 'smooth' });
    }
    const cap = $('#th-cap');
    if (cap) { cap.hidden = !th.captions || li < 0; if (li >= 0) cap.textContent = LINES[li][1]; }
  }
  function setPlaying(p) {
    th.playing = p;
    th.card.classList.toggle('playing', p);
    $('#th-play').innerHTML = icon(p ? 'pause' : 'play', 'ico-lg');
    $('#th-play').setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (p) { th.last = performance.now(); requestAnimationFrame(tick); }
  }
  function tick(now) {
    if (!th.playing) return;
    th.t += ((now - th.last) / 1000) * th.rate;
    th.last = now;
    if (th.t >= DUR) { th.t = DUR; setPlaying(false); osd('Ended · Up next is empty'); }
    paint();
    if (th.playing) requestAnimationFrame(tick);
  }
  let osdTimer;
  function osd(text) {
    th.osd.textContent = text;
    th.osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => th.osd.classList.remove('show'), 900);
  }
  function seekTo(t, label) {
    th.t = Math.max(0, Math.min(DUR, t));
    paint();
    if (label) osd(label);
  }
  function lightKey(id) {
    const row = $(`.th-key[data-k="${id}"]`);
    if (!row) return;
    row.classList.add('hit');
    setTimeout(() => row.classList.remove('hit'), 500);
  }
  function setDocked(d) {
    th.docked = d;
    th.card.classList.toggle('docked', d);
    th.stage.classList.toggle('is-docked', d);
    requestAnimationFrame(paint);
  }

  $('#th-play').addEventListener('click', () => setPlaying(!th.playing));
  $('#th-bigplay').addEventListener('click', (e) => { e.stopPropagation(); setPlaying(true); th.theatre.focus({ preventScroll: true }); });
  $('#th-picture').addEventListener('click', () => { if (th.docked) return; setPlaying(!th.playing); th.theatre.focus({ preventScroll: true }); });
  $('#th-dockbtn').addEventListener('click', (e) => { e.stopPropagation(); setDocked(!th.docked); });
  th.card.addEventListener('click', (e) => { if (th.docked && !e.target.closest('.th-controls')) setDocked(false); });
  $$('.th-chapter, .th-line').forEach((b) => b.addEventListener('click', () => { seekTo(+b.dataset.t, fmt(+b.dataset.t)); }));
  $('#th-sub').addEventListener('click', (e) => { const on = e.currentTarget.classList.toggle('on'); e.currentTarget.textContent = on ? 'Subscribed' : 'Subscribe'; toast(on ? 'Subscribed · The Phosphor Lab' : 'Unsubscribed'); });
  $('#th-save').addEventListener('click', () => toast('Saved · kept in data/tubcal.db'));
  $('#th-link').addEventListener('click', async () => {
    const ok = await copyText(`https://www.youtube.com/watch?v=EXAMPLE&t=${Math.floor(th.t)}s`);
    toast(ok ? `Link copied — starts at ${fmt(th.t)}` : 'Copy failed');
  });

  // seek bar: hover tip with chapter name, click/drag to seek
  th.seek.addEventListener('pointermove', (e) => {
    const r = th.bar.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = timeAtX(x);
    th.tip.style.left = `${Math.max(40, Math.min(r.width - 40, x))}px`;
    th.tip.innerHTML = `<b>${fmt(t)}</b>${esc(CHAPTERS[chapAt(t)].name)}`;
    if (e.buttons === 1) seekTo(t);
  });
  th.seek.addEventListener('pointerdown', (e) => {
    const r = th.bar.getBoundingClientRect();
    seekTo(timeAtX(e.clientX - r.left));
    th.seek.setPointerCapture(e.pointerId);
    th.theatre.focus({ preventScroll: true });
  });

  th.theatre.addEventListener('focus', () => th.theatre.classList.add('focused'));
  th.theatre.addEventListener('blur', () => th.theatre.classList.remove('focused'));
  th.theatre.addEventListener('keydown', (e) => {
    if (e.target !== th.theatre && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.metaKey || e.altKey) return;
    if (e.ctrlKey && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const k = e.key;
    let hit = true;
    if (k === ' ' || k === 'k' || k === 'K') { setPlaying(!th.playing); osd(th.playing ? '▶' : '❚❚'); lightKey('toggle'); }
    else if (k === 'j' || k === 'J') { seekTo(th.t - 10, '« 10 s'); lightKey('back10'); }
    else if (k === 'l' || k === 'L') { seekTo(th.t + 10, '10 s »'); lightKey('back10'); }
    else if (e.ctrlKey && k === 'ArrowLeft') {
      const i = chapAt(th.t);
      const target = th.t - CHAPTERS[i].t > 3 ? i : Math.max(0, i - 1);
      seekTo(CHAPTERS[target].t, `⏮ ${CHAPTERS[target].name}`); lightKey('chap');
    } else if (e.ctrlKey && k === 'ArrowRight') {
      const i = Math.min(CHAPTERS.length - 1, chapAt(th.t) + 1);
      seekTo(CHAPTERS[i].t, `⏭ ${CHAPTERS[i].name}`); lightKey('chap');
    } else if (k === 'ArrowLeft') { seekTo(th.t - 5, '« 5 s'); lightKey('back5'); }
    else if (k === 'ArrowRight') { seekTo(th.t + 5, '5 s »'); lightKey('back5'); }
    else if (/^[0-9]$/.test(k)) { seekTo((DUR * +k) / 10, `${+k * 10} %`); lightKey('pct'); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      th.vol = Math.max(0, Math.min(1, th.vol + (k === 'ArrowUp' ? 0.05 : -0.05)));
      th.muted = false; osd(`Volume ${Math.round(th.vol * 100)} %`); lightKey('vol');
    } else if (k === 'm' || k === 'M') { th.muted = !th.muted; osd(th.muted ? 'Muted' : `Volume ${Math.round(th.vol * 100)} %`); lightKey('vol'); }
    else if (k === '<' || k === '>') {
      const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      const i = steps.indexOf(th.rate);
      th.rate = steps[Math.max(0, Math.min(steps.length - 1, i + (k === '>' ? 1 : -1)))];
      osd(`${th.rate}×`); lightKey('rate');
    } else if (k === 'f' || k === 'F') {
      const pic = $('#th-picture');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (pic.requestFullscreen) pic.requestFullscreen().catch(() => {});
      lightKey('full');
    } else if (k === 'c' || k === 'C') { th.captions = !th.captions; paint(); osd(th.captions ? 'Captions on' : 'Captions off'); lightKey('full'); }
    else if (k === 'N' && e.shiftKey) { osd('Up next is empty'); lightKey('next'); }
    else if (k === 'Escape') { setDocked(!th.docked); lightKey('dock'); }
    else if (k === '?') { setTab('keys'); lightKey('help'); }
    else hit = false;
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  });
  setPlaying(false);
  paint();
  addEventListener('resize', paint);

  /* ════════════════════════════════════════════════════════════════════ *
   * 04 · The Anime — the index tree
   * ════════════════════════════════════════════════════════════════════ */
  const SEASONS = ['winter', 'spring', 'summer', 'fall'];
  const seasonAt = (off) => {
    let idx = Math.floor(today.getMonth() / 3) + off, y = today.getFullYear();
    while (idx < 0) { idx += 4; y--; }
    while (idx > 3) { idx -= 4; y++; }
    return { s: SEASONS[idx], y };
  };
  const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
  const sN = seasonAt(0), sX = seasonAt(1), sL = seasonAt(-1);
  const TREE = [
    { id: 'browse', label: 'Browse', desc: 'Trending, popular, top-rated and more, plus a genre/tag finder with every AniList filter — any mix of genres and tags, a sort dial and a text query. Infinite scroll.', tags: ['genre + tag finder', 'sort dial', 'infinite scroll'],
      files: [['Trending', 'kind=trending'], ['Popular', 'kind=popular'], ['This season', 'kind=seasonal'], ['Top rated', 'kind=top'], ['|search in'], ['Characters', 'in=characters'], ['Voices & staff', 'in=staff'], ['Studios', 'in=studios'], ['Users', 'in=users']] },
    { id: 'seasons', label: 'Seasons', desc: 'Any season’s line-up, laid out as a chart — this one, the next, the last, or any other.', tags: ['season chart', 'only my list'],
      files: [[`${cap1(sN.s)} ${sN.y}`, '', 'now'], [`${cap1(sX.s)} ${sX.y}`, `season=${sX.s}&year=${sX.y}`, 'next'], [`${cap1(sL.s)} ${sL.y}`, `season=${sL.s}&year=${sL.y}`, 'last'], ['Only my list', 'smine=1']] },
    { id: 'schedule', label: 'Schedule', desc: 'The week ahead as an airing grid, with a countdown to every episode.', tags: ['airing grid', 'countdowns', 'only my shows'],
      files: [['This week', ''], ['Next week', 'wk=1'], ['Last week', 'wk=-1'], ['Only my shows', 'tmine=1']] },
    { id: 'list', label: 'My List', desc: 'Your shelves with fast editing, bulk tools, custom lists, export (JSON, CSV, MyAnimeList XML) and the sequel radar — what comes next after everything you’ve finished. Synced to AniList as you tap: edits apply at once and sync on a short debounce, so a flurry of taps is one mutation.', tags: ['bulk tools', 'custom lists', 'export', 'sequel radar'],
      files: [['All', 'shelf=all', '148'], ['Watching', 'shelf=watching', '6'], ['Planning', 'shelf=planning', '41'], ['Completed', 'shelf=completed', '93'], ['Paused', 'shelf=paused', '5'], ['Dropped', 'shelf=dropped', '3'], ['|tools'], ['Pick for me', 'tool=pick'], ['Sequel radar', 'tool=radar']] },
    { id: 'ledger', label: 'Ledger', desc: 'Your statistics computed from the list itself — genres, formats, scores, time spent, hot takes — and a comparison of tastes with anyone (affinity is the Pearson correlation of shared scores).', tags: ['computed locally', 'hot takes', 'year in review', 'compare tastes'],
      files: [['Overview', ''], ['Hot takes', '#takes'], ['Year in review', '#wrapped'], ['Compare tastes', '#compare']] },
    { id: 'community', label: 'Community', desc: 'Reviews, people’s recommendation pairings (vote on them), today’s birthdays and the hall of fame.', tags: ['reviews', 'pairings', 'birthdays', 'hall of fame'],
      files: [['Reviews', 'c=reviews'], ['Pairings', 'c=recs'], ['Birthdays', 'c=birthdays'], ['Hall of fame', 'c=fame']] },
    { id: 'channel', label: 'Channel', desc: 'The Anime Channel — trailers related to what you’ve watched, played back to back like a station.', tags: ['trailers', 'play the channel'], files: [] },
    { id: 'discuss', label: 'Social', desc: 'The forum (threads beside the list), the activity stream, your inbox and people — profile pages, follow, message — with a live preview of every post as others will see it.', tags: ['forum', 'activity', 'inbox', 'live preview'],
      files: [['Forum', 'd=forum'], ['Everyone', 'd=activity'], ['Following', 'd=following'], ['Inbox', 'd=inbox', '3'], ['Your people', 'd=people']] },
  ];
  const atree = $('#atree');
  const aview = $('#aview');
  let aSel = { f: 'browse', i: 0 };
  function hrefAnime(folder, q) {
    const p = new URLSearchParams();
    if (folder.id !== 'browse') p.set('tab', folder.id);
    if (q && q[0] === '#') return `/anime${p.toString() ? `?${p}` : ''}${q}`;
    if (q) new URLSearchParams(q).forEach((v, k) => p.set(k, v));
    const s = p.toString();
    return `/anime${s ? `?${s}` : ''}`;
  }
  const openFolders = new Set(matchMedia('(max-width: 820px)').matches ? [] : ['browse']);
  function renderTree() {
    atree.innerHTML = TREE.map((f) => `
      <details ${openFolders.has(f.id) ? 'open' : ''}>
        <summary data-f="${f.id}" class="${aSel.f === f.id && aSel.i < 0 ? 'on' : ''}">${esc(f.label)}</summary>
        ${f.files.length ? `<div class="files">${f.files.map((x, i) => (x[0][0] === '|'
          ? `<span class="sep">${esc(x[0].slice(1))}</span>`
          : `<button class="file${aSel.f === f.id && aSel.i === i ? ' on' : ''}" data-f="${f.id}" data-i="${i}"><span>${esc(x[0])}</span>${x[2] ? `<small>${esc(x[2])}</small>` : ''}</button>`)).join('')}</div>` : ''}
      </details>`).join('');
    $$('.file', atree).forEach((b) => b.addEventListener('click', () => { aSel = { f: b.dataset.f, i: +b.dataset.i }; renderTree(); renderView(); }));
    $$('summary', atree).forEach((s) => s.addEventListener('click', (e) => {
      e.preventDefault();
      const id = s.dataset.f;
      if (aSel.f === id && openFolders.has(id)) openFolders.delete(id);
      else openFolders.add(id);
      aSel = { f: id, i: -1 };
      renderTree();
      renderView();
      const again = $(`summary[data-f="${id}"]`, atree);
      if (again) again.focus({ preventScroll: true });
    }));
  }
  function preview(id) {
    const covers = (n, h0) => `<div class="apv-covers">${Array.from({ length: n }, (_, i) => `<i style="--h:${(h0 + i * 47) % 360}"></i>`).join('')}</div>`;
    const ln = (w) => `<span class="ln" style="width:${w}%"></span>`;
    switch (id) {
      case 'browse': return covers(6, 20);
      case 'seasons': return covers(6, 190);
      case 'schedule': {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const slots = [[1, 0], [2, 1], [1, 0], [3, 0], [1, 0], [2, 0], [2, 0]];
        return `<div class="apv-week">${days.map((d, i) => `<div>${d}${Array.from({ length: slots[i][0] }, (_, k) => `<span class="${i === 1 && k === 0 ? 'soon' : ''}">${i === 1 && k === 0 ? 'in 2h' : `${18 + k * 2}:${k ? '30' : '00'}`}</span>`).join('')}</div>`).join('')}</div>`;
      }
      case 'list': return `<div class="apv-rows">${[['Lanterns of the Low Tide', 33, '4/12', 30], ['Orbit Café', 42, '10/24', 200], ['The Ninth Signal', 0, '0/13', 90], ['Paper Moon Radio', 75, '9/12', 320]]
        .map((r) => `<div class="apv-row"><i style="--h:${r[3]}"></i><span>${esc(r[0])}</span><em style="--p:${r[1]}%"></em><b>${r[2]}</b></div>`).join('')}</div>`;
      case 'ledger': return `<div class="apv-bars">${[['Slice of life', 82, 41], ['Sci-fi', 64, 32], ['Mystery', 48, 24], ['Comedy', 40, 20], ['Drama', 30, 15]]
        .map((r) => `<div class="apv-bar"><span>${r[0]}</span><em style="--p:${r[1]}%"></em><b>${r[2]}</b></div>`).join('')}</div>`;
      case 'community': return `<div class="apv-forum"><div>${['Review · 9/10', 'Review · 7/10', 'Pairing · +41'].map((t, i) => `<div class="apv-thread${i ? '' : ' on'}"><small>${t}</small>${ln(90)}${ln(60)}</div>`).join('')}</div><div>${ln(100)}${ln(94)}${ln(98)}${ln(70)}${ln(88)}${ln(40)}</div></div>`;
      case 'channel': return '<div class="apv-screen" aria-hidden="true"></div>';
      default: return `<div class="apv-forum"><div>${['Episode 12 discussion', 'Season wrap-up', 'Your favourite OP?'].map((t, i) => `<div class="apv-thread${i ? '' : ' on'}"><small>${24 - i * 7} replies</small>${esc(t)}</div>`).join('')}</div><div>${ln(96)}${ln(88)}${ln(100)}${ln(54)}${ln(80)}${ln(66)}</div></div>`;
    }
  }
  function renderView() {
    const f = TREE.find((x) => x.id === aSel.f);
    const file = aSel.i >= 0 ? f.files[aSel.i] : null;
    aview.innerHTML = `
      <div class="path">anime › <b>${esc(f.label.toLowerCase())}</b>${file ? ` › ${esc(file[0].toLowerCase())}` : ''}</div>
      <h3>${esc(file ? file[0] : f.label)}</h3>
      <p>${esc(f.desc)}</p>
      <div class="tags">${f.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="apv" aria-hidden="true">${preview(f.id)}</div>
      <code class="url">${esc(hrefAnime(f, file ? file[1] : ''))}</code>`;
  }
  renderTree();
  renderView();

  /* ════════════════════════════════════════════════════════════════════ *
   * 04 · The Reckoner
   * ════════════════════════════════════════════════════════════════════ */
  const SHOWS = [
    { id: 'lan', title: 'Lanterns of the Low Tide', glyph: '灯', eps: 12, aired: 12, dur: 24, progress: 4, cv: 'linear-gradient(160deg,#e7a857,#b0553a 55%,#3e5e8a)' },
    { id: 'orb', title: 'Orbit Café', glyph: '星', eps: 24, aired: 14, dur: 23, progress: 10, cv: 'linear-gradient(160deg,#6fc3d8,#3b4fa0 60%,#1b1e3c)', next: '3 days' },
    { id: 'nin', title: 'The Ninth Signal', glyph: '九', eps: 13, aired: 13, dur: null, progress: 0, cv: 'linear-gradient(160deg,#a9c46a,#2f4a3a 60%,#101a14)' },
  ];
  const RK_STORE = 'tubcal.docs.reckoner';
  let plan = [];
  try { plan = JSON.parse(localStorage.getItem(RK_STORE) || '[]').filter((p) => SHOWS.find((s) => s.id === p.id)); } catch (e) { plan = []; }
  const save = () => { try { localStorage.setItem(RK_STORE, JSON.stringify(plan)); } catch (e) { /* ignore */ } };
  let armed = null;
  let rkNote = '';
  const shelf = $('#rk-shelf');
  const dock = $('#rk-dock');
  const tallied = (id) => plan.filter((p) => p.id === id).length;

  function renderShelf() {
    shelf.innerHTML = SHOWS.map((s) => {
      const t = tallied(s.id);
      return `<div class="rk-card${armed === s.id ? ' armed' : ''}" data-show="${s.id}" tabindex="0" aria-label="${esc(s.title)}, episode ${s.progress} of ${s.eps}. Press C to tally the next episode.">
        <div class="rk-cover" style="--cv:${s.cv}"><span class="armed-tag">C ›</span><span class="glyph" lang="ja">${s.glyph}</span><span class="ttl">${esc(s.title)}</span></div>
        <div class="rk-meta">ep ${s.progress}/${s.eps}${s.aired < s.eps ? ` · ${s.aired} aired` : ''} · ${s.dur ? `${s.dur} min` : '? min'}</div>
        <div class="rk-prog"><i style="width:${(s.progress / s.eps) * 100}%"></i><i style="width:${((s.progress + t) / s.eps) * 100}%"></i></div>
        <button class="chip rk-add" data-add="${s.id}">+ 1 ep</button>
      </div>`;
    }).join('');
    $$('.rk-card', shelf).forEach((c) => {
      c.addEventListener('mouseenter', () => arm(c.dataset.show));
      c.addEventListener('focus', () => arm(c.dataset.show));
    });
    $$('[data-add]', shelf).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); arm(b.dataset.add); tally(b.dataset.add); }));
  }
  function arm(id) {
    if (armed === id) return;
    armed = id;
    $$('.rk-card', shelf).forEach((c) => c.classList.toggle('armed', c.dataset.show === id));
  }
  function tally(id) {
    const s = SHOWS.find((x) => x.id === id);
    const next = s.progress + tallied(id) + 1;
    if (next > s.aired) {
      rkNote = next > s.eps ? `${s.title}: that was the finale.` : `${s.title}: caught up — episode ${next} airs in ${s.next}.`;
      renderDock();
      return;
    }
    rkNote = '';
    plan.push({ id, ep: next });
    save();
    renderShelf();
    renderDock();
  }
  function renderDock() {
    const total = plan.reduce((m, p) => m + (SHOWS.find((s) => s.id === p.id).dur || 24), 0);
    const est = plan.some((p) => !SHOWS.find((s) => s.id === p.id).dur);
    const fin = new Date(Date.now() + total * 60000);
    const finStr = fin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dayDiff = Math.round((new Date(fin.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    dock.innerHTML = `
      <div><span class="kicker">The Reckoner</span><h4>${plan.length ? `${plan.length} episode${plan.length > 1 ? 's' : ''} queued` : 'Nothing tallied yet'}</h4></div>
      ${plan.length ? `<ol class="rk-rows">${plan.map((p) => { const s = SHOWS.find((x) => x.id === p.id); return `<li class="${s.dur ? '' : 'est'}"><span>${esc(s.title)} · ep ${p.ep}</span><span>${s.dur ? `${s.dur}m` : '24m est.'}</span></li>`; }).join('')}</ol>`
        : '<p class="rk-empty">Hover a cover and tap <kbd>C</kbd> — or press <b>+ 1 ep</b>.</p>'}
      ${plan.length ? `<div class="rk-total"><div class="big">${Math.floor(total / 60) ? `${Math.floor(total / 60)} h ` : ''}${total % 60} m</div>
        <div class="fin">Start now, finish at <b>${finStr}</b>${dayDiff > 0 ? ` <small>(+${dayDiff} day${dayDiff > 1 ? 's' : ''})</small>` : ''}</div>
        ${est ? '<div class="rk-note">Includes an estimate — AniList had no duration, so 24 min is assumed.</div>' : ''}</div>` : ''}
      ${rkNote ? `<p class="rk-note" style="color:var(--accent-strong)">${esc(rkNote)}</p>` : ''}
      ${plan.length ? '<button class="chip" id="rk-clear" style="align-self:flex-start">Clear the tally</button>' : ''}`;
    const clr = $('#rk-clear');
    if (clr) clr.addEventListener('click', () => { plan = []; rkNote = ''; save(); renderShelf(); renderDock(); });
  }
  let lastG = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'g') lastG = Date.now();
    if ((e.key !== 'c' && e.key !== 'C') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t && t.closest && t.closest('#theatre')) return;
    if (Date.now() - lastG < 1000) return; // g c is a room jump in the app; let it win
    if (!armed) return;
    const r = $('#rk').getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    e.preventDefault();
    tally(armed);
  });
  renderShelf();
  renderDock();
  setInterval(() => { if (plan.length) renderDock(); }, 30000);

  /* ════════════════════════════════════════════════════════════════════ *
   * 04 · The curtain call
   * ════════════════════════════════════════════════════════════════════ */
  const WORDS = ['', 'Appalling', 'Horrible', 'Very bad', 'Bad', 'Average', 'Fine', 'Good', 'Very good', 'Great', 'Masterpiece'];
  const curtain = $('#curtain');
  const rate = $('#cc-rate');
  let ccLast;
  rate.innerHTML = Array.from({ length: 10 }, (_, i) => `<button role="radio" aria-checked="false" data-v="${i + 1}" style="--v:${i + 1}" aria-label="${i + 1} — ${WORDS[i + 1]}">${i + 1}</button>`).join('');
  $$('button', rate).forEach((b) => {
    b.addEventListener('mouseenter', () => { $('#cc-word').textContent = WORDS[+b.dataset.v]; });
    b.addEventListener('click', () => {
      $$('button', rate).forEach((x) => x.setAttribute('aria-checked', x === b));
      $('#cc-word').textContent = `${WORDS[+b.dataset.v]} · ${b.dataset.v}/10`;
      toast(`Scored ${b.dataset.v}/10 — synced to AniList`);
    });
  });
  rate.addEventListener('mouseleave', () => {
    const on = $('button[aria-checked="true"]', rate);
    $('#cc-word').textContent = on ? `${WORDS[+on.dataset.v]} · ${on.dataset.v}/10` : 'How was it?';
  });
  $$('[data-plan]', curtain).forEach((b) => b.addEventListener('click', () => {
    $$('[data-plan]', curtain).forEach((x) => x.classList.toggle('on', x === b));
    toast(`Lanterns of the Low Tide II → ${b.dataset.plan}`);
  }));
  function openCurtain() {
    ccLast = document.activeElement;
    curtain.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => curtain.classList.add('open')));
    setTimeout(() => $('#curtain-x').focus(), reduce ? 0 : 700);
  }
  function closeCurtain() {
    curtain.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { curtain.hidden = true; if (ccLast) ccLast.focus(); }, reduce ? 0 : 900);
  }
  $('#curtain-x').innerHTML = icon('x', 'ico-lg');
  $('#curtain-open').addEventListener('click', openCurtain);
  $('#curtain-x').addEventListener('click', closeCurtain);
  curtain.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCurtain(); } });

  /* ════════════════════════════════════════════════════════════════════ *
   * 05 · The look — every card in its own skin
   * ════════════════════════════════════════════════════════════════════ */
  const BG = {
    dark: ['backdrop__lamp', 'backdrop__scan', 'backdrop__vignette'],
    light: ['backdrop__lamp', 'backdrop__scan', 'backdrop__vignette'],
    terminal: ['bd-term__scan', 'bd-term__flicker', 'bd-term__vignette'],
    aqua: ['bd-aqua__sky', 'bd-aqua__pin'],
    bauhaus: ['bd-bau__circle', 'bd-bau__bar', 'bd-bau__tri'],
    blueprint: ['bd-bp__grid', 'bd-bp__vignette'],
    space: ['bd-space__nebula', 'bd-space__stars'],
  };
  const skinsEl = $('#skins');
  skinsEl.innerHTML = T.skins.map((s) => `
    <button class="skincard" data-theme="${s.value}" data-skin="${s.value}" aria-pressed="false">
      <div class="backdrop sk-bg" aria-hidden="true">${BG[s.value].map((c) => `<div class="${c}"></div>`).join('')}</div>
      <div class="sk-top"><span>ch 1 · hub</span><span class="sk-on"><i></i>on air</span></div>
      <div class="tc-wordmark">Tubcal<em>.</em></div>
      <div class="sk-keys"><span class="on">01</span><span>02</span><span>03</span><span>04</span></div>
      <div class="sk-name">${esc(s.label)}</div>
      <div class="sk-blurb">${esc(s.blurb)}</div>
    </button>`).join('');
  function markSkin() {
    const cur = document.documentElement.dataset.theme;
    $$('.skincard', skinsEl).forEach((c) => c.setAttribute('aria-pressed', c.dataset.skin === cur));
  }
  $$('.skincard', skinsEl).forEach((c) => c.addEventListener('click', () => window.TC.setSkin(c.dataset.skin, true)));
  document.addEventListener('tubcal:skin', markSkin);
  markSkin();

  /* ── privacy: stagger the packets ── */
  $$('#lines li').forEach((li, i) => li.style.setProperty('--n', i));

  window.TC.wireCopyButtons();
})();
