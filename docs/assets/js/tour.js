/* The Tour — the guide at the top, then one stop per channel. Each channel's
   rooms are shown as screenshots of the real app (assets/shots/). The demos
   are small, faithful models of how the app behaves (the Edition with and
   without AI, the player's keys and corner dock, rooms renumbering), drawn
   with invented sample content. */

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
   * The bar, and the guide at the top
   * ════════════════════════════════════════════════════════════════════ */
  const STOP_C = { home: 'var(--signal)', social: 'var(--c-foryou)', coding: 'var(--c-editor)', video: 'var(--c-youtube)', anime: 'var(--accent-strong)', saved: 'var(--c-editor)', look: 'var(--rail-3)', privacy: 'var(--c-dev)', get: 'var(--signal)' };
  const stops = T.tour.filter((s) => s.id !== 'top' && s.stop !== false);
  const pad2 = (n) => String(n).padStart(2, '0');
  const roomsOf = (ch) => T.rooms.filter((r) => r.channel === ch);

  $('#bar-stops').innerHTML = stops.map((s) => `<a href="#${s.id}" data-stop="${s.id}" style="--stop-c:${STOP_C[s.id]}">${esc(s.title.replace(' & Settings', '').replace(/^The /, ''))}</a>`).join('');

  // the guide: each channel and its rooms, numbered as the app numbers them
  $('#hg-channels').innerHTML = T.channels
    .map((ch) => {
      let no = 0;
      const rooms = roomsOf(ch.id);
      return `<div class="hg-ch">
        <div class="hg-chhead"><b>${ch.n} · ${esc(ch.label)}</b><span>${esc(ch.line)}</span></div>
        <ol class="hg-rooms">${rooms
          .map((r) => `<li><a href="#${ch.id}" data-guide-room="${r.id}" style="--room-c:${r.color}">
            <span class="hg-no">${r.on ? pad2(++no) : '—'}</span><span class="hg-name">${esc(r.label)}</span>
            <span class="hg-what">${esc(r.line)}${r.on ? '' : '<small>off at first</small>'}</span></a></li>`)
          .join('')}</ol>
      </div>`;
    })
    .join('');
  $$('[data-guide-room]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('tubcal:room', { detail: a.dataset.guideRoom }));
  }));

  const bar = $('#bar');
  const top = $('#top');
  const stopLinks = $$('#bar-stops a');
  function onScroll() {
    const past = top.getBoundingClientRect().bottom < 80;
    bar.classList.toggle('show', past);
    let cur = null;
    stops.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.4) cur = s.id;
    });
    stopLinks.forEach((a) => a.classList.toggle('on', a.dataset.stop === cur));
    // keep the current stop in sight when the bar is too narrow for them all
    const on = stopLinks.find((a) => a.dataset.stop === cur);
    const strip = $('#bar-stops');
    if (on && cur !== lastStop) {
      lastStop = cur;
      if (on.offsetLeft < strip.scrollLeft) strip.scrollLeft = on.offsetLeft - 8;
      else if (on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = on.offsetLeft + on.offsetWidth - strip.clientWidth + 8;
    }
  }
  let lastStop = null;
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ════════════════════════════════════════════════════════════════════ *
   * 01 · Home — how each channel is laid out
   * ════════════════════════════════════════════════════════════════════ */
  const LAYOUT = {
    social: 'A bar across the top of the page, like the section names in a newspaper. It stays in place while you read.',
    coding: 'Laid out like a code editor: the rooms are buttons down the left, and a bar across the top shows where you are.',
    video: 'A wooden panel down the left, like the side of an old TV. The room you’re in lists its own places under its button.',
  };
  $('#channel-cards').innerHTML = T.channels
    .map((ch) => `<li style="--press-c:${ch.color}"><span class="kicker">Channel ${ch.n}</span><b>${esc(ch.label)}</b>
      <span>${roomsOf(ch.id).map((r) => esc(r.label)).join(', ')}.</span><span>${esc(LAYOUT[ch.id])}</span></li>`)
    .join('');

  /* ════════════════════════════════════════════════════════════════════ *
   * 06 · Saved & Settings — Settings → Rooms, numbered inside each channel
   * ════════════════════════════════════════════════════════════════════ */
  const today = new Date();
  const active = new Set(T.rooms.filter((r) => r.on).map((r) => r.id));

  function renderToggles() {
    $('#sr-grid').innerHTML = T.channels
      .map((ch) => {
        let no = 0;
        return `<div class="sr-ch"><h4 class="sr-chname" style="--ch-c:${ch.color}">${ch.n} · ${esc(ch.label)}</h4><div class="sr-grid">${roomsOf(ch.id)
          .map((r) => {
            const on = r.fixed || active.has(r.id);
            const n = on ? pad2(++no) : '—';
            const control = r.fixed
              ? '<span class="sr-fixed">always on</span>'
              : `<span class="switch" style="--sw-c:${r.color}"><input type="checkbox" data-toggle="${r.id}" ${on ? 'checked' : ''} aria-label="${esc(r.label)}"><span class="track"></span></span>`;
            return `<label class="sr-item${on ? '' : ' off'}"><span class="sr-no">${n}</span><span class="sr-name">${esc(r.label)}</span>${control}</label>`;
          })
          .join('')}</div></div>`;
      })
      .join('');
    $$('[data-toggle]').forEach((cb) =>
      cb.addEventListener('change', () => {
        cb.checked ? active.add(cb.dataset.toggle) : active.delete(cb.dataset.toggle);
        renderToggles();
        const r = T.rooms.find((x) => x.id === cb.dataset.toggle);
        const ch = T.channels.find((c) => c.id === r.channel);
        const left = roomsOf(ch.id).filter((x) => x.fixed || active.has(x.id)).length;
        toast(`${r.label} ${cb.checked ? 'on' : 'off'} · ${ch.label} has ${left} room${left === 1 ? '' : 's'}`);
        $(`[data-toggle="${r.id}"]`)?.focus({ preventScroll: true });
      }),
    );
  }
  renderToggles();

  /* ════════════════════════════════════════════════════════════════════ *
   * 02 · Social — the Edition, with and without AI
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
    const status = c ? 'written' : e ? 'matched' : 'headlines';

    $$('#rungs li').forEach((li) => {
      const r = +li.dataset.rung;
      li.classList.toggle('lit', r === 0 || (r === 1 && e) || (r === 2 && c));
    });
    $('#ladder-note').innerHTML = c
      ? `<b>Written.</b> Each top story is now a short article. The small numbers say which post each part came from.`
      : e
        ? `<b>Matched.</b> The video about Kestrel 2.0 is now part of the top story. It links to a different page, so without matching it was listed on its own.`
        : `<b>Headlines only</b>, no AI. Posts that link to the same page are grouped into one story, with their points and comment counts.`;

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
      ${c ? `<span class="np-stamp">✓ sources checked · ${lede.length}/${lede.length}</span>` : ''}`;
  }
  emb.addEventListener('change', () => renderPaper(true));
  chat.addEventListener('change', () => renderPaper(true));
  renderPaper(false);

  /* ════════════════════════════════════════════════════════════════════ *
   * 04 · Video — the player
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
    [190, 'Coils around the neck of the tube steer the beam. That’s the deflection yoke.'],
    [272, 'Wherever the beam lands, a phosphor coating glows for a moment.'],
    [365, 'The glow fades quickly, so the beam has to come back many times a second.'],
    [462, 'The beam sweeps left to right, line by line, top to bottom: the raster.'],
    [570, 'Each trip back to the left is blanked, so you never see the retrace.'],
    [682, 'Interlacing draws the odd lines, then the even ones, to halve the flicker.'],
    [820, 'Two fields make one frame, a bandwidth trick that lasted for decades.'],
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
  $('#th-save').addEventListener('click', () => toast('Saved · find it under Saved'));
  $('#th-link').addEventListener('click', async () => {
    const ok = await copyText(`https://www.youtube.com/watch?v=EXAMPLE&t=${Math.floor(th.t)}s`);
    toast(ok ? `Link copied · starts at ${fmt(th.t)}` : 'Copy failed');
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
   * Screenshots of the real app, one viewer per stop
   * ════════════════════════════════════════════════════════════════════ */
  // Everything but the Anime is shot on a demo profile that follows public
  // channels, subreddits and projects, so none of it is anyone's own feed.
  const HOME = [
    { id: 'home', label: 'The home screen', alt: 'The home screen: a greeting, a TV showing a half-watched video, a row of what’s next under it, a clock, three channel knobs and a coming-up list beside it, and a guide for each channel below.',
      text: 'The TV is tuned to the video or episode you were last watching, with a button to carry on, and the row under it holds what’s next. Beside it are a clock, the three channel knobs and what’s coming up, such as live streams. Below the TV, a guide for each channel shows what’s in it: today’s paper, the files you had open, new uploads and your anime list.' },
  ];
  const SOCIAL = [
    { id: 'edition', room: 'edition', label: 'The Edition', tab: 'Edition', c: 'var(--c-foryou)', alt: 'The Edition: a newspaper front page led by a photo of a nebula from r/astrophotography with a short written article, two Hacker News stories beside it and more columns below.',
      text: 'This morning’s paper, made from the test setup’s subreddits, channels and Hacker News. The stories were written by a local AI, and each one links to the posts it came from. The ring at the top counts how many you’ve read.' },
    { id: 'hackernews', room: 'hackernews', label: 'The Wire', tab: 'Wire', c: 'var(--c-hn)', alt: 'The Wire: Hacker News’s top stories as a numbered list, each with its site, points, a heat bar and a comment count.',
      text: 'Hacker News’s top stories as a numbered list. The bar beside each one shows how fast it’s gaining points. The tabs switch to Best, New, Ask, Show and Jobs, and the search box looks through every story ever posted. Open a story and its comments appear beside the list.' },
    { id: 'reddit', room: 'reddit', label: 'The Dispatch', tab: 'Dispatch', c: 'var(--c-reddit)', alt: 'The Dispatch: subreddit chips across the top, then posts laid out like a newspaper.',
      text: 'Your subreddits laid out like a newspaper, with pictures shown large. This is Reddit without signing in. Open a post to read its comments.' },
  ];
  const CODING = [
    { id: 'editor', room: 'editor', label: 'The Composing Room', tab: 'Composing Room', c: 'var(--c-editor)', alt: 'The Composing Room: a file tree on the left, a source file open in a tab, and the vim mode, file and git branch in the bar at the bottom.',
      text: 'A code editor with vim keys, shown here with Tubcal’s own source code. The file tree is on the left, open files are tabs, and the bar at the bottom shows the vim mode, the file and the git branch. The bar at the top shows the folder it works in and the tools it found, such as git and a terminal.' },
    { id: 'dev', room: 'dev', label: 'The Workbench', tab: 'Workbench', c: 'var(--c-dev)', alt: 'The Workbench: a shelf of four languages, Rust open with its facts and current version, and a row of Rust talks below.',
      text: 'A page for each of four programming languages, picked from the shelf on the left. Here it’s Rust: its main facts and current version, then talks, podcasts you can play on the page, news from the core team and popular projects further down.' },
    { id: 'github', room: 'github', label: 'GitHub', c: 'var(--c-github)', alt: 'The GitHub room: a list of views on the left, today’s pull requests and issues from followed projects in the middle, and the latest releases and trending projects on the right.',
      text: 'What the projects you follow have been doing, day by day and project by project: commits, pull requests, issues and releases. Beside it are the latest releases and what’s trending today. The list on the left switches to releases, trending, who you follow and your local copies, and shows how many GitHub requests are left this hour. Open a project to read its files, issues and pull requests.' },
  ];
  const VIDEO = [
    { id: 'youtube', room: 'youtube', label: 'Screening Room', c: 'var(--c-youtube)', alt: 'The Screening Room: the newest upload large, a list of other new uploads beside it, and the half-watched videos below.',
      text: 'The newest upload from your channels is on the big screen, with the rest of what just came in beside it. Below are the videos you didn’t finish, and further down each channel has its own shelf. The panel on the left lists your channels with a count of new videos.' },
    { id: 'archive', room: 'archive', label: 'The Archive', tab: 'Archive', c: 'var(--signal)', alt: 'The Archive: a box for questions, and a transcript search for the word “proof” with results from two videos, each at a timestamp.',
      text: 'Videos you’ve watched, transcribed on your own computer. A search finds the moments a word was said, and clicking one plays the video from there. With the optional AI set up, you can also ask questions and read a digest of what you watched.' },
  ];
  const SAVED = [
    { id: 'drawer', label: 'The Saved panel', tab: 'Saved panel', c: 'var(--c-editor)', alt: 'The Saved panel open at the right of a page, with a Save page button, a search box and a list of saved things.',
      text: 'Press Saved in any bar, or Space then s. The panel slides over the page you’re on. It can save that page itself, find anything you’ve kept, and open it, tick it done or remove it.' },
    { id: 'saved', label: 'The Saved page', tab: 'Saved page', c: 'var(--c-editor)', alt: 'The Saved page: a catalogue by channel and kind on the left, and saved videos, stories and projects laid out on shelves.',
      text: 'Everything you’ve saved, sorted by channel and then by kind, with a count for each. Each kind has its own layout, or you can switch to a plain list. You can add a note to anything, mark it done, search your notes and titles, and remove many at once.' },
    { id: 'settings', label: 'The Settings panel', tab: 'Settings panel', c: 'var(--signal)', alt: 'The Settings panel open at the right of a page: the skins, a few switches, and a list of every settings section.',
      text: 'Press Settings in any bar, or Space then comma. The skins and the switches people change most are right there, and every other section is one click away.' },
  ];
  const ANIME = [
    { id: 'browse', label: 'Browse', alt: 'The Browse view: the Video panel on the left with the Anime’s views under it, the top trending show in a large card, and a row of posters below.',
      text: 'Trending, popular and top-rated shows, with the top one shown large. The finder filters by any mix of genres and tags, and more results load as you scroll.' },
    { id: 'seasons', label: 'Seasons', alt: 'The Seasons view: this season’s line-up as a programme guide, each show with its next airing time, synopsis and trailer button.',
      text: 'A season’s shows laid out like a TV guide: when each episode airs, how far along the show is, its trailer and where to stream it. Tick “only my list” to see just the shows you follow.' },
    { id: 'schedule', label: 'Schedule', alt: 'The Schedule view: a week laid out in seven columns, each listing the episodes airing that day with their times.',
      text: 'Every episode airing this week, as a timetable. Shows on your list are marked, with a total of how long they’ll take to watch. You can add the schedule to your calendar.' },
    { id: 'list', label: 'My List', alt: 'My List: shelves of posters, each with how far you are, how many episodes are left and a button to play the next one.',
      text: 'Your shelves, as posters or as rows. Each show says how far you are and what’s new, with a button that plays the next episode. “Gathering dust” lists shows you’ve stopped watching, and Pick for me and Sequel radar suggest what to watch next.' },
    { id: 'ledger', label: 'Ledger', alt: 'The Ledger: days of anime watched in large type, your mean score, a bar chart of your scores and how your list breaks down by shelf.',
      text: 'Statistics worked out from your list: days watched, how you score, how the list breaks down, favourite genres, the shows you rate unlike everyone else, and a year in review.' },
    { id: 'title', label: 'Title page', alt: 'A title page: the poster, the title and its details, rankings, the trailer and opening-song buttons, and your own list entry below.',
      text: 'Everything about one show: trailer, opening song, rankings, studios, and the cast with every dub’s voice actors. Below that is your own entry: where you are, your score and your notes.' },
    { id: 'reckoner', label: 'The Reckoner', alt: 'My List with the Reckoner open in the right margin, totalling ten episodes across four shows and the time you would finish.',
      text: 'Point at a show and press C. The Reckoner, in the margin, adds that show’s next unwatched episode (aired ones only), keeps a running total of the time, and tells you when you’d finish if you started now.' },
    { id: 'curtain', label: 'Curtain call', alt: 'The curtain call after finishing a season: a verdict of Masterpiece on a one-to-ten row, category scores, and a review form with a live preview.',
      text: 'This opens when you finish a season. Score it on your AniList scale (by category too, if you use that), join the discussion of the last episode, or write a review and see how it will look on AniList.' },
  ];

  // Each view is shot in every skin, so the screenshots wear whichever skin
  // this page has on.
  const SHOT_SKINS = T.skins.map((s) => s.value);
  const shotSkin = () => (SHOT_SKINS.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'dark');

  // full size, in a lightbox
  const box = $('#shotbox');
  const boxImg = $('#shotbox-img');
  $('#shotbox-x').innerHTML = icon('x', 'ico-lg');
  $('#shotbox-x').addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => { if (e.target === box || e.target === boxImg) box.close(); });
  function openBox(img) {
    boxImg.src = img.src;
    boxImg.alt = img.alt;
    if (box.showModal) box.showModal(); else window.open(img.src, '_blank', 'noopener');
  }

  function shotViewer(root, prefix, list) {
    const src = (id) => `assets/shots/${prefix}-${id}-${shotSkin()}.webp`;
    const tabs = $('.shots-tabs', root);
    const panel = $('.shots-stage', root);
    const frame = $('.shots-frame', root);
    const img = $('img', frame);
    const cap = $('.shots-cap', root);
    let at = 0;

    const single = list.length === 1;
    tabs.innerHTML = list.map((s, i) => `<button class="shots-tab" role="tab" id="${prefix}-tab-${s.id}" aria-controls="${panel.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}"${s.c ? ` style="--tab-c:${s.c}"` : ''}><small>${String(i + 1).padStart(2, '0')}</small>${esc(s.tab || s.label)}</button>`).join('');
    tabs.hidden = single;
    const tabEls = $$('.shots-tab', tabs);

    function show(i, focus) {
      at = (i + list.length) % list.length;
      const s = list[at];
      tabEls.forEach((b, k) => { b.setAttribute('aria-selected', k === at); b.tabIndex = k === at ? 0 : -1; });
      panel.setAttribute('aria-labelledby', `${prefix}-tab-${s.id}`);
      img.src = src(s.id);
      img.alt = s.alt;
      cap.innerHTML = `<span class="kicker">${single ? 'screenshot' : `${String(at + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')} · screenshot`}</span>
        <h3>${esc(s.label)}</h3><p>${esc(s.text)}</p>
        ${single ? '' : '<div class="shots-nav"><button class="chip" data-step="-1" aria-label="Previous">‹ Previous</button><button class="chip" data-step="1" aria-label="Next">Next ›</button></div>'}`;
      $$('[data-step]', cap).forEach((b) => b.addEventListener('click', () => show(at + +b.dataset.step)));
      if (focus) tabEls[at].focus({ preventScroll: true });
    }
    tabEls.forEach((b) => {
      b.addEventListener('click', () => show(+b.dataset.i));
      // warm the next image while the pointer is on its way
      b.addEventListener('pointerenter', () => { new Image().src = src(list[+b.dataset.i].id); }, { once: true });
    });
    tabs.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) { e.preventDefault(); show(at + step, true); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : list.length - 1, true); }
    });
    document.addEventListener('tubcal:skin', () => { img.src = src(list[at].id); });
    frame.addEventListener('click', () => openBox(img));
    show(0);
    return { show, index: (room) => list.findIndex((s) => s.room === room) };
  }

  shotViewer($('#home-shots'), 'app', HOME);
  shotViewer($('#saved-shots'), 'app', SAVED);
  shotViewer($('#anime-shots'), 'anime', ANIME);
  const channelShots = {
    social: shotViewer($('#social-shots'), 'app', SOCIAL),
    coding: shotViewer($('#coding-shots'), 'app', CODING),
    video: shotViewer($('#video-shots'), 'app', VIDEO),
  };

  // a room picked in the guide at the top, or in the search palette: its
  // channel's stop, with its screenshot showing (the Anime has a stop of its own)
  document.addEventListener('tubcal:room', (e) => {
    const room = T.rooms.find((r) => r.id === e.detail);
    if (!room) return;
    if (room.id === 'anime') { window.TC.goSection('anime'); return; }
    const viewer = channelShots[room.channel];
    const i = viewer.index(room.id);
    if (i >= 0) viewer.show(i);
    window.TC.goSection(room.channel);
  });

  /* ════════════════════════════════════════════════════════════════════ *
   * 07 · The look — every card in its own skin
   * ════════════════════════════════════════════════════════════════════ */
  const BG = {
    dark: ['backdrop__lamp', 'backdrop__scan', 'backdrop__vignette'],
    light: ['backdrop__lamp', 'backdrop__scan', 'backdrop__vignette'],
    terminal: ['bd-term__scan', 'bd-term__flicker', 'bd-term__vignette'],
    aqua: ['bd-aqua__sky', 'bd-aqua__pin'],
    bauhaus: ['bd-bau__circle', 'bd-bau__bar', 'bd-bau__tri'],
    blueprint: ['bd-bp__grid', 'bd-bp__vignette'],
    space: ['bd-space__nebula', 'bd-space__stars'],
    bench: ['bd-bench__mat', 'bd-bench__grid', 'bd-bench__light'],
  };
  const skinsEl = $('#skins');
  skinsEl.innerHTML = T.skins.map((s) => `
    <button class="skincard" data-theme="${s.value}" data-skin="${s.value}" aria-pressed="false">
      <div class="backdrop sk-bg" aria-hidden="true">${BG[s.value].map((c) => `<div class="${c}"></div>`).join('')}</div>
      <div class="sk-top"><span>ch 3 · video</span><span class="sk-on"><i></i>on air</span></div>
      <div class="tc-wordmark">Tubcal<em>.</em></div>
      <div class="sk-keys"><span>1</span><span>2</span><span class="on">3</span></div>
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
