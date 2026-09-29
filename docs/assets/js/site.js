/* Tubcal docs — shared behaviour: skins, backdrop, command palette, keyboard
   chords, the shortcut sheet, copy buttons, toasts and scroll reveals.
   Plain JS, no dependencies. The keyboard model follows the app's: global keys
   stand down while you type, and a widget that owns its keys (the player demo,
   the Reckoner) marks itself with [data-owns-keys]. */

(function () {
  'use strict';

  const T = window.TUBCAL;
  const root = document.documentElement;
  const page = document.body.dataset.page || 'tour';
  const STORE = 'tubcal.docs.theme';
  root.classList.add('js');

  // ── tiny helpers ──────────────────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ── skins ─────────────────────────────────────────────────────────────────
  const LAYERS = {
    dark: ['backdrop__lamp', 'backdrop__floor', 'backdrop__scan', 'backdrop__grain', 'backdrop__vignette'],
    terminal: ['bd-term__scan', 'bd-term__flicker', 'bd-term__vignette'],
    aqua: ['bd-aqua__sky', 'bd-aqua__pin'],
    bauhaus: ['bd-bau__circle', 'bd-bau__bar', 'bd-bau__tri'],
    blueprint: ['bd-bp__grid', 'bd-bp__grid bd-bp__grid--fine', 'bd-bp__vignette'],
    space: ['bd-space__nebula', 'bd-space__stars', 'bd-space__stars bd-space__stars--far'],
  };
  LAYERS.light = LAYERS.dark;

  const skinMeta = (v) => T.skins.find((s) => s.value === v) || T.skins[0];
  const currentSkin = () => root.dataset.theme || 'dark';

  function paintBackdrop(v) {
    const bd = $('#backdrop');
    if (!bd) return;
    bd.innerHTML = (LAYERS[v] || LAYERS.dark).map((c) => `<div class="${c}"></div>`).join('');
  }

  function dotsHTML(v) {
    return `<span class="dots" aria-hidden="true">${skinMeta(v).swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
  }

  function setSkin(v, announce) {
    const meta = skinMeta(v);
    root.dataset.theme = meta.value;
    try { localStorage.setItem(STORE, meta.value); } catch (e) { /* storage may be blocked */ }
    paintBackdrop(meta.value);
    $$('[data-skin-label]').forEach((el) => { el.textContent = meta.label; });
    $$('[data-skin-dots]').forEach((el) => { el.innerHTML = dotsHTML(meta.value); });
    const tc = $('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', meta.swatch[0]);
    document.dispatchEvent(new CustomEvent('tubcal:skin', { detail: meta.value }));
    if (announce) toast(`Skin · ${meta.label}`);
  }
  function nextSkin() {
    const vals = T.skins.map((s) => s.value);
    const i = vals.indexOf(currentSkin());
    setSkin(vals[(i + 1) % vals.length], true);
  }

  // ── toast ─────────────────────────────────────────────────────────────────
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = `<span class="led"></span>${esc(msg)}`;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  }

  // ── copy ──────────────────────────────────────────────────────────────────
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  function wireCopyButtons(scope = document) {
    $$('.codeblock', scope).forEach((cb) => {
      const btn = $('.copy', cb);
      if (!btn || btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.innerHTML = `${icon('copy')}<span>Copy</span>`;
      btn.addEventListener('click', async () => {
        const src = $('pre', cb);
        const text = btn.dataset.text || (src ? src.innerText.replace(/[ \t]+#[^\n]*$/gm, '').trimEnd() : '');
        const ok = await copyText(text);
        btn.classList.toggle('done', ok);
        btn.innerHTML = ok ? `${icon('check')}<span>Copied</span>` : `${icon('x')}<span>Failed</span>`;
        setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = `${icon('copy')}<span>Copy</span>`; }, 1600);
      });
    });
  }

  // ── sections of this page (for j/k and the chords) ────────────────────────
  const pageSections = () => $$('[data-section]');
  function goSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  }
  function stepSection(dir) {
    const secs = pageSections();
    if (!secs.length) return;
    const y = window.scrollY + 100;
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    let cur = -1;
    secs.forEach((s, i) => { if (top(s) <= y) cur = i; });
    let target;
    if (dir > 0) target = cur + 1;
    else target = cur >= 0 && y - top(secs[cur]) > 60 ? cur : cur - 1;
    target = Math.max(0, Math.min(secs.length - 1, target));
    goSection(secs[target].id);
  }

  const TOUR_URL = './';
  const MANUAL_URL = 'manual.html';
  const hrefFor = (where, id) => (where === page ? `#${id}` : `${where === 'tour' ? TOUR_URL : MANUAL_URL}${id ? `#${id}` : ''}`);

  // ── command palette ───────────────────────────────────────────────────────
  let scrim, pal, palInput, palList, palItems = [], palSel = 0;

  function paletteEntries() {
    const out = [];
    const add = (group, list, where) =>
      list.forEach((s, i) =>
        out.push({
          group,
          title: s.title,
          sub: s.sub,
          pn: where === 'manual' ? String(i + 1).padStart(2, '0') : s.chord ? `g${s.chord}` : '·',
          where: where === page ? 'here' : where,
          run: () => (where === page ? goSection(s.id) : (location.href = hrefFor(where, s.id))),
        }),
      );
    if (page === 'manual') {
      add('The Manual · channel 2', T.manual, 'manual');
      add('The Tour · channel 1', T.tour, 'tour');
    } else {
      add('The Tour · channel 1', T.tour, 'tour');
      add('The Manual · channel 2', T.manual, 'manual');
    }
    T.rooms.forEach((r) =>
      out.push({
        group: 'Rooms',
        title: r.label,
        sub: r.line,
        pn: '▸',
        where: page === 'tour' ? 'here' : 'tour',
        run: () => {
          if (page === 'tour') {
            goSection('hub');
            document.dispatchEvent(new CustomEvent('tubcal:room', { detail: r.id }));
          } else location.href = `${TOUR_URL}#hub`;
        },
      }),
    );
    T.skins.forEach((s) =>
      out.push({ group: 'Skins', title: s.label, sub: s.blurb, pn: '◐', where: 'skin', run: () => setSkin(s.value, true) }),
    );
    out.push(
      { group: 'Actions', title: 'Cycle the skin', sub: 'press t', pn: 't', where: 'action', run: nextSkin },
      { group: 'Actions', title: 'Keyboard shortcuts', sub: 'press ?', pn: '?', where: 'action', run: openKeys },
      { group: 'Actions', title: 'Copy the quick start', sub: 'uv sync · npm run build · uv run python main.py', pn: '⧉', where: 'action', run: async () => { const ok = await copyText(QUICKSTART); toast(ok ? 'Quick start copied' : 'Copy failed'); } },
      { group: 'Actions', title: 'Open the repository', sub: 'github.com/Shio-T0/Tubcal', pn: '↗', where: 'github', run: () => window.open(T.repo, '_blank', 'noopener') },
    );
    if (window.TUBCAL_ROUTES && page === 'manual') {
      out.push({ group: 'Actions', title: 'Search the API', sub: `${window.TUBCAL_ROUTES.length} routes`, pn: '/', where: 'here', run: () => { goSection('api'); setTimeout(() => { const f = $('#api-q'); if (f) f.focus(); }, 450); } });
    }
    return out;
  }
  const QUICKSTART = 'uv sync\ncd frontend && npm install && npm run build && cd ..\nuv run python main.py';

  function score(q, text) {
    if (!q) return 1;
    text = text.toLowerCase();
    const at = text.indexOf(q);
    if (at >= 0) return 100 - at;
    let ti = 0, hits = 0;
    for (const ch of q) {
      const f = text.indexOf(ch, ti);
      if (f < 0) return 0;
      hits += f === ti ? 2 : 1;
      ti = f + 1;
    }
    return hits;
  }

  function buildPalette() {
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search the docs">
        <label class="palette-in">${icon('search', 'ico-lg')}
          <input id="pal-q" type="text" placeholder="Jump to a section, a room, a skin…" autocomplete="off" spellcheck="false" aria-controls="pal-list" />
          <kbd>esc</kbd>
        </label>
        <ul class="palette-list" id="pal-list" role="listbox"></ul>
        <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> go</span><span><kbd>t</kbd> cycle skin</span><span><kbd>?</kbd> all keys</span></div>
      </div>`;
    document.body.appendChild(scrim);
    pal = $('.palette', scrim);
    palInput = $('#pal-q', scrim);
    palList = $('#pal-list', scrim);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closePalette(); });
    palInput.addEventListener('input', renderPalette);
    palInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); movePal(1); }
      else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); movePal(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    });
  }
  function renderPalette() {
    const q = palInput.value.trim().toLowerCase();
    const all = paletteEntries();
    const ranked = all
      .map((it, i) => ({ it, i, s: Math.max(score(q, it.title), score(q, it.sub || '') * 0.6, score(q, it.group) * 0.3) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (q ? b.s - a.s || a.i - b.i : a.i - b.i));
    palItems = ranked.map((x) => x.it);
    palSel = 0;
    if (!palItems.length) {
      palList.innerHTML = `<li class="palette-empty">Nothing on this channel matches “${esc(q)}”.</li>`;
      return;
    }
    let html = '', lastGroup = '';
    palItems.forEach((it, i) => {
      if (!q && it.group !== lastGroup) {
        html += `<li class="palette-group" role="presentation">${esc(it.group)}</li>`;
        lastGroup = it.group;
      }
      const where = { here: 'this page', tour: 'the tour', manual: 'the manual', skin: 'skin', action: '', github: 'github ↗' }[it.where] || '';
      html += `<li class="palette-item${i === 0 ? ' on' : ''}" role="option" data-i="${i}" aria-selected="${i === 0}">
        <span class="pn">${esc(it.pn)}</span>
        <span class="pt">${esc(it.title)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
        <span class="pw">${esc(where)}</span></li>`;
    });
    palList.innerHTML = html;
    $$('.palette-item', palList).forEach((li) => {
      li.addEventListener('mousemove', () => selPal(+li.dataset.i));
      li.addEventListener('click', () => runPal(+li.dataset.i));
    });
  }
  function selPal(i) {
    const lis = $$('.palette-item', palList);
    if (!lis.length) return;
    palSel = (i + lis.length) % lis.length;
    lis.forEach((li, k) => { li.classList.toggle('on', k === palSel); li.setAttribute('aria-selected', k === palSel); });
    lis[palSel].scrollIntoView({ block: 'nearest' });
  }
  const movePal = (d) => selPal(palSel + d);
  function runPal(i) {
    const it = palItems[i];
    if (!it) return;
    closePalette();
    it.run();
  }
  let lastFocus;
  function openPalette() {
    if (!scrim) buildPalette();
    closeKeys();
    lastFocus = document.activeElement;
    scrim.classList.add('open');
    palInput.value = '';
    renderPalette();
    setTimeout(() => palInput.focus(), 0);
  }
  function closePalette() {
    if (!scrim || !scrim.classList.contains('open')) return;
    scrim.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ── the shortcut sheet (?) ────────────────────────────────────────────────
  let keysScrim;
  function openKeys() {
    closePalette();
    if (!keysScrim) {
      keysScrim = document.createElement('div');
      keysScrim.className = 'scrim';
      const list = page === 'manual' ? T.manual : T.tour;
      const chords = list.filter((s) => s.chord).map((s) => `<div class="keyrow"><span>${esc(s.title)}</span><span><kbd>g</kbd><kbd>${s.chord}</kbd></span></div>`).join('');
      keysScrim.innerHTML = `
        <div class="keysheet" role="dialog" aria-modal="true" aria-labelledby="ks-title">
          <div class="keysheet-head"><div><span class="kicker">This page speaks the app's keys</span><h3 id="ks-title">Keyboard</h3></div>
          <button class="iconbtn" data-close aria-label="Close">${icon('x', 'ico-lg')}</button></div>
          <div class="keysheet-cols">
            <div>
              <div class="keyrow"><span>Channel 1 · the tour</span><span><kbd>1</kbd></span></div>
              <div class="keyrow"><span>Channel 2 · the manual</span><span><kbd>2</kbd></span></div>
              <div class="keyrow"><span>Search everything</span><span><kbd>/</kbd> or <kbd>Ctrl</kbd><kbd>K</kbd></span></div>
              <div class="keyrow"><span>Next · previous section</span><span><kbd>j</kbd> <kbd>k</kbd></span></div>
              <div class="keyrow"><span>Top · bottom</span><span><kbd>g</kbd><kbd>g</kbd> · <kbd>G</kbd></span></div>
              <div class="keyrow"><span>Cycle the skin</span><span><kbd>t</kbd></span></div>
              <div class="keyrow"><span>This sheet</span><span><kbd>?</kbd></span></div>
            </div>
            <div>${chords}</div>
          </div>
        </div>`;
      document.body.appendChild(keysScrim);
      keysScrim.addEventListener('mousedown', (e) => { if (e.target === keysScrim) closeKeys(); });
      $('[data-close]', keysScrim).addEventListener('click', closeKeys);
    }
    keysScrim.classList.add('open');
    $('[data-close]', keysScrim).focus();
  }
  function closeKeys() {
    if (keysScrim) keysScrim.classList.remove('open');
  }

  // ── g-chords ──────────────────────────────────────────────────────────────
  let chordEl, chordTimer, chordArmed = false;
  function armChord() {
    chordArmed = true;
    if (!chordEl) {
      chordEl = document.createElement('div');
      chordEl.className = 'chord';
      chordEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(chordEl);
    }
    const list = (page === 'manual' ? T.manual : T.tour).filter((s) => s.chord);
    chordEl.innerHTML = `<span class="kicker">g …</span><ul>
      <li><kbd>g</kbd> top</li>${list.map((s) => `<li><kbd>${s.chord}</kbd> ${esc(s.title)}</li>`).join('')}</ul>`;
    chordEl.classList.add('open');
    clearTimeout(chordTimer);
    chordTimer = setTimeout(disarmChord, 1400);
  }
  function disarmChord() {
    chordArmed = false;
    if (chordEl) chordEl.classList.remove('open');
  }

  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      scrim && scrim.classList.contains('open') ? closePalette() : openPalette();
      return;
    }
    if (e.key === 'Escape') {
      closePalette();
      closeKeys();
      disarmChord();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return;
    if (typing(e.target)) return;
    if ((scrim && scrim.classList.contains('open')) || (keysScrim && keysScrim.classList.contains('open'))) return;
    if (e.target.closest && e.target.closest('[data-owns-keys]')) return;

    const k = e.key;
    if (chordArmed) {
      disarmChord();
      if (k === 'g') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); history.replaceState(null, '', location.pathname); return; }
      const s = (page === 'manual' ? T.manual : T.tour).find((x) => x.chord === k);
      if (s) { e.preventDefault(); goSection(s.id); }
      return;
    }
    if (k === 'g') { e.preventDefault(); armChord(); return; }
    if (k === 'G') { e.preventDefault(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); return; }
    if (k === '/') { e.preventDefault(); openPalette(); return; }
    if (k === '?') { e.preventDefault(); openKeys(); return; }
    if (k === 't') { e.preventDefault(); nextSkin(); return; }
    if (k === 'j') { e.preventDefault(); stepSection(1); return; }
    if (k === 'k') { e.preventDefault(); stepSection(-1); return; }
    if (k === '1') { e.preventDefault(); page === 'tour' ? goSection('hub') : (location.href = TOUR_URL); return; }
    if (k === '2') { e.preventDefault(); page === 'manual' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : (location.href = MANUAL_URL); return; }
  });

  // ── wiring on load ────────────────────────────────────────────────────────
  function fillToday() {
    const line = new Date()
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .replace(/,/g, ' ·');
    $$('[data-today]').forEach((el) => { el.textContent = line; });
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
  }
  function wireReveals() {
    const els = $$('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('seen')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('seen'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    els.forEach((el) => io.observe(el));
  }
  function wireButtons() {
    $$('[data-open-palette]').forEach((b) => b.addEventListener('click', openPalette));
    $$('[data-cycle-skin]').forEach((b) => b.addEventListener('click', nextSkin));
    $$('[data-open-keys]').forEach((b) => b.addEventListener('click', openKeys));
    $$('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.iconClass || '')); });
  }

  window.TC = { $, $$, esc, icon, toast, copyText, setSkin, nextSkin, skinMeta, currentSkin, goSection, wireCopyButtons, openPalette, page };

  setSkin(currentSkin(), false);
  fillToday();
  wireButtons();
  wireCopyButtons();
  wireReveals();
})();
