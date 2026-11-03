// The set plays the programme you're reading about. One <video> for the whole page,
// so only one film loads at a time. Scrolling the guide tunes the set; so do the
// titles, the steps under them (they also jump to that moment) and the knobs.
(() => {
  const progs = [...document.querySelectorAll('.prog')];
  if (!progs.length) return;
  const $ = (id) => document.getElementById(id);
  const tv = $('tv'), chno = $('chno'), chname = $('chname'), beatEl = $('beat'), bar = $('bar');
  const pp = $('pp'), lamp = $('lamp'), bigplay = $('bigplay'), setwrap = $('setwrap'), cab = document.querySelector('.cab');
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  let cur = -1;
  let paused = still.matches;      // with reduced motion nothing plays until asked
  let beats = [];                  // [{t, el}]
  let pending = 0;
  let quietUntil = 0;              // after a click, don't let scrolling retune for a moment

  // ── a burst of static between channels ────────────────────────────────
  const canvas = $('static');
  const ctx = canvas.getContext('2d');
  let staticUntil = 0;
  const noise = () => {
    const w = (canvas.width = 160), h = (canvas.height = 90);
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v; img.data[i + 1] = v * 0.92; img.data[i + 2] = v * 0.8; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (performance.now() < staticUntil) requestAnimationFrame(noise);
    else canvas.classList.remove('on');
  };
  const burst = () => {
    if (still.matches) return;
    staticUntil = performance.now() + 260;
    canvas.classList.add('on');
    requestAnimationFrame(noise);
  };

  // ── playing ───────────────────────────────────────────────────────────
  const showState = () => {
    const on = !tv.paused && !tv.ended;
    pp.classList.toggle('paused', !on);
    pp.setAttribute('aria-label', on ? 'Pause' : 'Play');
    lamp.classList.toggle('on', on);
    cab.style.setProperty('--glow', on ? '0.3' : '0.14');
    bigplay.hidden = on || !paused;
  };
  const play = () => {
    if (paused || !seen) { showState(); return; }
    const p = tv.play();
    // only a refusal to autoplay counts as paused; a play() cut short by a pause() doesn't
    if (p) p.catch((e) => { if (e && e.name === 'NotAllowedError') { paused = true; showState(); } });
  };

  const markBeat = () => {
    const t = tv.currentTime;
    let k = -1;
    for (let i = 0; i < beats.length; i++) if (beats[i].t <= t + 0.05) k = i;
    beats.forEach((b, i) => b.el.classList.toggle('now', i === k));
    const text = k >= 0 ? beats[k].el.textContent.trim() : '';
    if (beatEl.textContent !== text) beatEl.textContent = text;
  };

  const tune = (i, { seek = null } = {}) => {
    i = Math.max(0, Math.min(progs.length - 1, i));
    const p = progs[i];
    if (i !== cur) {
      cur = i;
      progs.forEach((x, j) => x.classList.toggle('on', j === i));
      chno.textContent = p.dataset.ch;
      chname.textContent = p.querySelector('.name').textContent;
      beats = [...p.querySelectorAll('.beats button')].map((el) => ({ t: parseFloat(el.dataset.t) || 0, el }));
      burst();
      tv.poster = p.dataset.poster;
      tv.src = p.dataset.src;
      bar.style.width = '0';
      if (seek) tv.addEventListener('loadedmetadata', () => { tv.currentTime = seek; }, { once: true });
      if (location.hash !== `#${p.id}` && cur !== 0) history.replaceState(null, '', `#${p.id}`);
      else if (cur === 0 && location.hash) history.replaceState(null, '', location.pathname);
      markBeat();
    } else if (seek !== null) {
      tv.currentTime = seek;
    }
    play();
  };

  tv.addEventListener('timeupdate', markBeat);
  tv.addEventListener('play', showState);
  tv.addEventListener('pause', showState);
  tv.addEventListener('ended', () => { tv.currentTime = 0; play(); });
  const tick = () => {
    if (tv.duration) bar.style.width = `${(100 * tv.currentTime) / tv.duration}%`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ── where the reader is ───────────────────────────────────────────────
  const narrow = () => innerWidth <= 980;
  const anchorY = () => {
    if (!narrow()) return innerHeight * 0.42;
    const b = setwrap.getBoundingClientRect().bottom;
    return b + (innerHeight - b) * 0.3;
  };
  const scrollToProg = (i) => {
    const el = progs[i].querySelector('.tune');
    const y = el.getBoundingClientRect().top + scrollY - anchorY() + 8;
    quietUntil = performance.now() + 900;
    scrollTo({ top: Math.max(0, y), behavior: still.matches ? 'auto' : 'smooth' });
  };
  const pick = () => {
    if (performance.now() < quietUntil) return;
    const a = anchorY();
    let k = 0;
    progs.forEach((p, i) => { if (p.getBoundingClientRect().top <= a) k = i; });
    if (k !== cur) {
      clearTimeout(pending);
      pending = setTimeout(() => tune(k), 180);
    }
  };
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; pick(); });
  }, { passive: true });

  // ── clicks ────────────────────────────────────────────────────────────
  progs.forEach((p, i) => {
    p.querySelector('.tune').addEventListener('click', () => {
      paused = false;
      tune(i, { seek: 0 });
      scrollToProg(i);
    });
    p.querySelectorAll('.beats button').forEach((b) => b.addEventListener('click', () => {
      paused = false;
      quietUntil = performance.now() + 900;
      tune(i, { seek: parseFloat(b.dataset.t) || 0 });
    }));
  });
  pp.addEventListener('click', () => {
    if (tv.paused) { paused = false; play(); } else { paused = true; tv.pause(); }
  });
  bigplay.addEventListener('click', () => { paused = false; play(); });
  $('prev').addEventListener('click', () => { paused = false; tune(cur - 1, { seek: 0 }); scrollToProg(cur); });
  $('next').addEventListener('click', () => { paused = false; tune(cur + 1, { seek: 0 }); scrollToProg(cur); });

  // the set rests while it's out of sight (reading how to install, say)
  let seen = true;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting === seen) return;
    seen = e.isIntersecting;
    if (!seen) tv.pause();
    else play();
  }).observe($('screen'));

  // copy the install line
  const copy = $('copy');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('cmd').textContent.trim());
      copy.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren($('cmd'));
      copy.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 2200);
  });

  // ── start ─────────────────────────────────────────────────────────────
  const fromHash = progs.findIndex((p) => `#${p.id}` === location.hash);
  if (fromHash > 0) {
    tune(fromHash);
    requestAnimationFrame(() => scrollToProg(fromHash));
  } else {
    tune(0);
  }
  showState();
})();
