// The sorter — By topic's machine (pages/ByTopic.jsx), built for 3D objects.
//
// A five-sided wooden column stands on a turntable. Its glass dome holds the
// reading lamp (the local AI) and a plate with the model's name; a reel at the
// left feeds it a paper tape printed with the front page's headlines, and a
// newsroom spike stands at the right. While a sort runs the lamp pulses, the
// tape crawls and the column turns slowly. Each wedge carries a brass band with
// its topic's plate (stamped once the AI has named the five topics) and a
// counter. As each batch of headlines comes back, its slips drop out of the dome
// one by one: one that fits slides into its topic's wedge and the counter rolls
// on; one that fits nowhere flies out onto the spike.
//
// When the sort is in, the column splits: the clasps open, the five wedges slide
// out across the turntable, and each wedge's front unfolds like a folding screen
// into a wide panel holding its topic's stories. The panels stand round the
// turntable; the one facing you is flat and readable, and the machine turns like
// the home box (lib/turntable.js): drag, a sideways swipe, ← →, Tab, h / l at a
// panel's edge, the topic tabs underneath, and 1–5 (the page). Sorting again
// closes it the same way backwards.
//
// The turned panels are only for show. While the machine is still, a flat copy
// of the one facing you stands exactly over it (.front): text under a 3D
// transform comes out blurred, so that copy is the one you read and use, and it
// hands its scroll position to its twin whenever a turn starts.
//
// The geometry (sizes in px from the stage's size) is worked out here and handed
// to the CSS as custom properties; the CSS places everything. Slips are made and
// flown with the Web Animations API, outside React, and removed when they land.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import StoryLine from '../wire/StoryLine.jsx';
import { isStill } from '../../lib/motion.js';
import { useGutter, useTurntable } from '../../lib/turntable.js';
import m from './sorter.module.css';

export const TONES = ['var(--c-hn)', 'var(--c-youtube)', 'var(--c-editor)', 'var(--c-github)', 'var(--c-dev)'];
const N = 5;
const IDS = ['1', '2', '3', '4', '5'];
const DROP_MS = 80; // between one slip and the next
const FLIGHT_MS = 950;
const SPIN = 7; // degrees a second the column turns while it sorts

/** Sizes for a stage `w` wide and `h` tall. The front of a closed wedge is `c`
 *  wide, an opened panel `P`; a0 / a1 are how far they stand from the middle. */
function geometry(w, h) {
  const narrow = w < 900;
  const P = Math.round(w * (narrow ? 0.84 : 0.6));
  const c = Math.round(w * (narrow ? 0.2 : 0.14));
  const k = 1 / (2 * Math.tan(Math.PI / N)); // apothem per unit of side
  const T = 92; // room over the faces for the dome
  const foot = 74; // the apron under them
  return {
    w, h, P, c, T, foot, narrow,
    a0: c * k,
    a1: P * k * 1.12, // a little more than a closed pentagon of panels: gaps between them
    hf: Math.max(300, h - T - foot),
    persp: Math.round(w * 1.7),
  };
}

const hash = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);

/** The server's sentences mark a command `like this`; show it as code. */
export function Said({ text }) {
  // eslint-disable-next-line react/no-array-index-key
  return String(text || '').split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

/** A name stamped in letter by letter (words kept whole across lines). */
function Letters({ text }) {
  let k = 0;
  return (
    <span className={m.letters} aria-label={text}>
      {text.split(' ').map((word, w) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={w} className={m.word} aria-hidden="true">
          {[...word].map((ch) => {
            k += 1;
            return <span key={k} style={{ '--d': `${k * 45}ms` }}>{ch}</span>;
          })}
        </span>
      ))}
    </span>
  );
}

function Odometer({ value }) {
  return (
    <span className={m.odo} aria-label={`${value} sorted`}>
      <span key={value} className={m.odoNum}>{String(value).padStart(2, '0')}</span>
    </span>
  );
}

function Panel({ topic, tight, late, openId, onOpen, seen, newSince }) {
  const count = topic.items.length;
  return (
    <div className={`${m.panel} ${late ? m.panelLate : ''}`}>
      <header className={m.head}>
        <b className={m.no}>{topic.n}</b>
        <div className={m.headText}>
          <h2 className={m.name}>{topic.name}</h2>
          {topic.about && <p className={m.about}>{topic.about}</p>}
        </div>
        <span className={m.count}><b>{count}</b> {count === 1 ? 'story' : 'stories'}</span>
      </header>
      <div className={m.list}>
        {count ? topic.items.map((it) => (
          <StoryLine
            key={it.id}
            item={it}
            rank={it.extra?.rank ?? 0}
            open={it.extra?.hn_id === openId}
            onOpen={onOpen}
            seen={seen[it.extra?.hn_id]}
            fresh={newSince(it)}
            tight={tight}
          />
        )) : <p className={m.empty}>Nothing on the front page fitted this topic.</p>}
      </div>
    </div>
  );
}

/**
 * topics: [{ n, name, about, items }] or null (not named yet). spiked: [{ id,
 * title, rank }]. tape: the headlines on the reel. sorting: a sort is under way.
 * model: the AI's name for the dome's plate. card: { title, text } to hang on a
 * closed column (out of order, jammed). side / onSide: the topic facing you ('1'
 * to '5'). onSort: the dome was pressed (null when it can't sort).
 */
export default function Sorter({
  topics, spiked = [], tape = [], sorting, model, card, side, onSide, onSort,
  openId, onOpen, seen, newSince,
}) {
  const wrap = useRef(null);
  const bleed = useRef(null);
  const front = useRef(null);
  const overlay = useRef(null);
  const bands = useRef([]);
  const spikeTip = useRef(null);
  const geo = useRef(null);
  const [g, setG] = useState(null);

  // ── which slips have landed, and the ones still to drop ──
  const landed = useRef(new Set());
  const queue = useRef([]);
  const inflight = useRef(new Set());
  const timer = useRef(0);
  const seeded = useRef(false);
  const wasSorting = useRef(sorting);
  const [pending, setPending] = useState(0);
  const [, bump] = useState(0);

  const open = !sorting && !!topics && pending === 0;
  const [late, setLate] = useState(false); // the panels are coming in after a split

  // The flat copy and its turned twin keep one scroll position between them.
  const shown = useRef(0);
  const onStill = (still) => {
    const twin = faces.current[shown.current]?.querySelector(`.${m.list}`);
    const flat = front.current?.querySelector(`.${m.list}`);
    if (!twin || !flat) return;
    if (still) flat.scrollTop = twin.scrollTop;
    else twin.scrollTop = flat.scrollTop;
  };

  const {
    facing, stage, turner, faces, shades, stageProps, commit, turnBy, towards, hold, angle,
  } = useTurntable({ ids: IDS, side, onSide, enabled: open, front, onStill });
  shown.current = facing;
  useGutter(wrap, bleed);

  // ── geometry from the stage's size ──
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const measure = () => {
      const next = geometry(el.clientWidth, el.clientHeight);
      geo.current = next;
      setG((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  // ── the slips ──
  const arrivals = useMemo(() => {
    const out = [];
    (topics || []).forEach((t) => t.items.forEach((it) => out.push({ id: it.id, n: t.n, rank: it.extra?.rank ?? 999, title: it.title })));
    spiked.forEach((s) => out.push({ id: s.id, n: 0, rank: s.rank ?? 999, title: s.title }));
    return out.sort((a, b) => a.rank - b.rank);
  }, [topics, spiked]);

  const count = () => setPending(queue.current.length + inflight.current.size);
  const spikedOn = () => spiked.filter((s) => landed.current.has(s.id)).length;

  const flash = (n) => {
    const el = n ? bands.current[n - 1] : spikeTip.current;
    if (!el) return;
    el.classList.remove(m.hit);
    void el.offsetWidth; // start the flash over
    el.classList.add(m.hit);
  };

  const fly = (a) => {
    const gg = geo.current;
    const host = a.n ? turner.current : overlay.current;
    if (!gg || !host) { landed.current.add(a.id); return; }
    inflight.current.add(a.id);
    const el = document.createElement('div');
    el.className = m.slip;
    el.textContent = a.title;
    el.style.setProperty('--tone', a.n ? TONES[a.n - 1] : 'var(--paper-faint)');
    host.appendChild(el);
    let frames;
    if (a.n) {
      // out of the dome, over the front of its wedge, and into the band's slot
      const turn = `rotateY(${(a.n - 1) * 72}deg)`;
      const z = gg.a0;
      const y = gg.hf * 0.4;
      frames = [
        { transform: `${turn} translate3d(-50%, -30px, 0) scale(0.35)`, opacity: 0 },
        { transform: `${turn} translate3d(-50%, -8px, ${z * 0.4}px) scale(0.8)`, opacity: 1, offset: 0.22 },
        { transform: `${turn} translate3d(-50%, ${y * 0.55}px, ${z + 46}px) rotateX(-14deg) scale(0.92)`, opacity: 1, offset: 0.68 },
        { transform: `${turn} translate3d(-50%, ${y}px, ${z + 4}px) scale(0.5)`, opacity: 0 },
      ];
    } else {
      // out of the dome and down onto the top of the pile, at a slant of its own
      const spike = spikeTip.current?.parentElement?.getBoundingClientRect();
      const box = overlay.current.getBoundingClientRect();
      const onPile = Math.min(spikedOn(), 17);
      const x0 = gg.w / 2;
      const y0 = gg.T * 0.55;
      const x1 = spike ? spike.left + spike.width / 2 - box.left : gg.w * 0.92;
      const y1 = spike ? spike.bottom - box.top - 35 - onPile * 4 : gg.h - gg.foot;
      const tilt = (hash(a.id) % 24) - 12;
      frames = [
        { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.35)`, opacity: 0 },
        { transform: `translate(${x0 + 30}px, ${y0 - 26}px) translate(-50%, -50%) rotate(-8deg) scale(0.85)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${(x0 + x1) / 2 + 40}px, ${Math.min(y0, y1) - 60}px) translate(-50%, -50%) rotate(${tilt * 2}deg)`, offset: 0.6 },
        { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) rotate(${tilt}deg) scale(0.34, 1.2)`, opacity: 1 },
      ];
    }
    const anim = el.animate(frames, { duration: FLIGHT_MS, easing: 'cubic-bezier(.35,.05,.35,1)', fill: 'forwards' });
    const done = () => {
      el.remove();
      inflight.current.delete(a.id);
      landed.current.add(a.id);
      flash(a.n);
      count();
      bump((x) => x + 1);
    };
    anim.onfinish = done;
    anim.oncancel = done;
  };

  const run = () => {
    if (timer.current) return;
    const next = () => {
      const a = queue.current.shift();
      if (!a) { timer.current = 0; count(); return; }
      fly(a);
      count();
      timer.current = setTimeout(next, DROP_MS);
    };
    next();
  };

  useEffect(() => {
    if (sorting && !wasSorting.current) {
      // a new sort: the old one's slips are gone
      landed.current = new Set();
      queue.current = [];
    }
    wasSorting.current = sorting;
    const known = (a) => landed.current.has(a.id) || inflight.current.has(a.id) || queue.current.some((q) => q.id === a.id);
    const fresh = arrivals.filter((a) => !known(a));
    if (!seeded.current || isStill()) {
      // what was already sorted when the page opened has landed already
      seeded.current = true;
      fresh.forEach((a) => landed.current.add(a.id));
      bump((x) => x + 1);
      return;
    }
    if (!fresh.length) return;
    queue.current.push(...fresh);
    count();
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals, sorting]);

  useEffect(() => () => {
    clearTimeout(timer.current);
  }, []);

  // ── the slow turn while it sorts ──
  useEffect(() => {
    if (!sorting || isStill()) return undefined;
    let raf = 0;
    let last = performance.now();
    let deg = angle();
    const tick = (now) => {
      deg -= ((now - last) / 1000) * SPIN;
      last = now;
      hold(deg);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  // ── opening after a sort (not when the page opens on one) ──
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && !isStill()) {
      setLate(true);
      const t = setTimeout(() => setLate(false), 2600);
      wasOpen.current = open;
      return () => clearTimeout(t);
    }
    wasOpen.current = open;
    return undefined;
  }, [open]);

  const style = g ? {
    '--w': `${g.w}px`,
    '--P': `${g.P}px`,
    '--c': `${g.c}px`,
    '--a0': `${g.a0.toFixed(1)}px`,
    '--a1': `${g.a1.toFixed(1)}px`,
    '--T': `${g.T}px`,
    '--hf': `${g.hf}px`,
    '--foot': `${g.foot}px`,
    '--persp': `${g.persp}px`,
  } : undefined;

  const spikedLanded = spiked.filter((s) => landed.current.has(s.id));
  const pile = spikedLanded.slice(-18);
  const tight = g ? g.P < 680 : false;
  const label = open && topics ? `By topic, turned to ${topics[facing]?.name}` : 'By topic: the sorter';

  return (
    <div ref={wrap} className={m.wrap}>
      <div ref={bleed} className={m.bleed}>
        <div
          ref={stage}
          className={m.stage}
          style={style}
          {...stageProps}
          data-open={open || undefined}
          data-narrow={g?.narrow || undefined}
          data-late={late || undefined}
          data-sorting={sorting || undefined}
          data-lit={sorting || onSort ? '' : undefined}
          role="region"
          aria-roledescription="sorting machine"
          aria-label={label}
          aria-busy={sorting || undefined}
        >
          <div className={m.scene}>
            <div className={m.rig}>
              <div ref={turner} className={m.table}>
                <div className={m.disc} aria-hidden="true" />
                {IDS.map((id, i) => {
                  const t = topics?.[i];
                  const tone = TONES[i];
                  const sorted = t ? t.items.filter((it) => landed.current.has(it.id)).length : 0;
                  return (
                    <section
                      key={id}
                      ref={(el) => { faces.current[i] = el; }}
                      className={m.face}
                      style={{ '--i': i, '--tone': tone }}
                      data-facing={(open && i === facing) || undefined}
                      inert
                      aria-label={t ? `${t.n}. ${t.name}` : `Topic ${i + 1}`}
                    >
                      <div className={m.leaf} aria-hidden="true" />
                      <span className={`${m.seam} ${m.seamL}`} aria-hidden="true" />
                      <span className={`${m.seam} ${m.seamR}`} aria-hidden="true" />
                      <div ref={(el) => { bands.current[i] = el; }} className={m.band} aria-hidden="true">
                        <span className={m.clasp} />
                        <span className={m.tag}>
                          <b>{i + 1}</b>
                          {t ? <Letters key={t.name} text={t.name} /> : <i className={m.blank} />}
                        </span>
                        <Odometer value={sorted} />
                        <span className={m.clasp} />
                      </div>
                      {open && t && (
                        <Panel topic={t} tight={tight} late={late} openId={openId} onOpen={onOpen} seen={seen} newSince={newSince} />
                      )}
                      <span ref={(el) => { shades.current[i] = el; }} className={m.shade} aria-hidden="true" />
                    </section>
                  );
                })}
              </div>
              <button
                type="button"
                className={m.dome}
                onClick={onSort || undefined}
                disabled={!onSort || sorting}
                title={sorting ? `${model} is reading the headlines` : onSort ? 'Sort the front page again' : undefined}
                aria-label={sorting ? 'Sorting' : 'Sort again'}
                tabIndex={open ? -1 : 0}
              >
                <span className={m.glass}><span className={m.lamp} /></span>
                <span className={m.domeBase}>{model || 'no model'}</span>
              </button>
            </div>
          </div>

          {open && topics?.[facing] && (
            <section
              ref={front}
              className={m.front}
              style={{ '--tone': TONES[facing] }}
              inert={late}
              aria-label={`${topics[facing].n}. ${topics[facing].name}`}
            >
              <div className={m.leaf} aria-hidden="true" />
              <Panel
                key={topics[facing].n}
                topic={topics[facing]}
                tight={tight}
                openId={openId}
                onOpen={onOpen}
                seen={seen}
                newSince={newSince}
              />
            </section>
          )}

          <div ref={overlay} className={m.overlay}>
            <svg className={m.tape} viewBox={g ? `0 0 ${g.w} ${g.h}` : undefined} aria-hidden="true">
              {g && (
                <>
                  <path
                    id="sorter-tape"
                    d={`M ${g.w * 0.085} ${g.h - g.foot - 64} C ${g.w * 0.14} ${g.T * 0.4}, ${g.w * 0.33} ${g.T * 0.05}, ${g.w / 2 - 34} ${g.T * 0.42}`}
                  />
                  <text>
                    <textPath href="#sorter-tape" startOffset="0">
                      {tape.length ? tape.join('   ✂   ') : 'HN · front page · top 100'}
                      {sorting && !isStill() && <animate attributeName="startOffset" values="-24000;0" dur="420s" repeatCount="indefinite" />}
                    </textPath>
                  </text>
                </>
              )}
            </svg>
            <div className={m.reel} aria-hidden="true"><i /></div>
            <div className={m.apron} aria-hidden="true">
              <span className={m.plate}>By topic</span>
            </div>
            <div className={m.spike}>
              <span ref={spikeTip} className={m.spikeTip} aria-hidden="true" />
              <div className={m.pile}>
                {pile.map((s, k) => (
                  <span key={s.id} title={s.title} style={{ '--k': k, '--tilt': `${(hash(s.id) % 24) - 12}deg` }} />
                ))}
              </div>
              <span className={m.spikeCount}><b>{spikedLanded.length}</b> spiked</span>
            </div>
            {card && !open && (
              <div className={m.card} role="status">
                <b>{card.title}</b>
                <p><Said text={card.text} /></p>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className={`${m.dial} tc-strip`} aria-label="Topics">
        <button type="button" className={m.step} onClick={() => turnBy(-1)} disabled={!open} aria-label="Turn left" title="Turn left (←)">
          <ChevronLeft size={16} />
        </button>
        {IDS.map((id, i) => {
          const t = topics?.[i];
          return (
            <button
              key={id}
              type="button"
              className={`${m.tab} ${open && i === facing ? m.tabOn : ''}`}
              style={{ '--tone': TONES[i] }}
              aria-current={(open && i === facing) || undefined}
              disabled={!open}
              onClick={() => { if (i !== facing) commit(towards(i)); }}
            >
              <b>{i + 1}</b>
              <span>{t?.name || '·····'}</span>
              {open && t && <small>{t.items.length}</small>}
            </button>
          );
        })}
        <button type="button" className={m.step} onClick={() => turnBy(1)} disabled={!open} aria-label="Turn right" title="Turn right (→)">
          <ChevronRight size={16} />
        </button>
      </nav>
    </div>
  );
}
