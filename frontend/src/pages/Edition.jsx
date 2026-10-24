// The Edition — today's paper, composed on this machine from every room.
//
// It reads like a front page, not a feed. The nameplate: the issue and date in
// one ear, how much of this paper you've read (a ring, and a 読了 stamp once it's
// all done) in the other. Under it the strip: page-turns to the paper before and
// after, the back-issue drawer, Next unread, Mark all read, Recompose and the
// paper's settings. Then the front: the lead story (headline over a picture with
// its copy beside it), two more down a rail, the rest of the columns ruled in a
// row, and In Brief grouped by the room each line came from. Past the nameplate a
// slim bar follows you down the page with your progress and Next unread.
//
// It moves like paper: the title is pressed in letter by letter, the rule draws
// out from the middle, stories settle as they scroll into view, a turned page
// swings in from the side it came from, the lead's picture develops, ticks draw
// themselves and a press roller sweeps the page while it recomposes. Fast mode
// (Settings → Appearance) and reduced motion keep all of it still.
//
// Keys: u next unread · [ ] the paper before / after · j k (and h l) walk the
// stories · Enter opens one. Read ticks are per paper, in this browser.

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCheck, RefreshCw, Settings2 } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox } from '../components/layout/Section.jsx';
import { hasModule, moduleLazy, moduleLazyNamed } from '../lib/modules.js';
import { Briefs, Lede, Story } from '../components/edition/Stories.jsx';
import { useReadMarks } from '../components/edition/readMarks.js';
import { isStill, scrollMotion } from '../lib/motion.js';
import { useParamState } from '../lib/urlState.js';
import { usePlayer } from '../state.jsx';
import e from './edition.module.css';

// The readers belong to the Wire and the Dispatch; a story from a room this copy
// doesn't have opens at its source instead (openOutside).
const RedditPostModal = moduleLazy('reddit', () => import('../components/modals/RedditPostModal.jsx'));
const ReaderSheet = moduleLazyNamed('hackernews', () => import('../components/wire/HNReader.jsx'), 'ReaderSheet');

function openOutside(it) {
  const url = it.platform === 'hackernews'
    ? `https://news.ycombinator.com/item?id=${it.extra?.hn_id || String(it.id).replace(/^hn:/, '')}`
    : it.url;
  if (url) window.open(url, '_blank', 'noopener');
}

// ── dates ────────────────────────────────────────────────────────────────────

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
const hhmm = (epoch) => new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// ── the nameplate ────────────────────────────────────────────────────────────

/** "The Edition", pressed in one letter at a time. */
function Title({ className = e.title, as: Tag = 'h1' }) {
  const letters = (word, from) => [...word].map((ch, i) => (
    <span key={i} className={e.letter} style={{ '--i': from + i }}>{ch}</span>
  ));
  return (
    <Tag className={className} aria-label="The Edition">
      <span aria-hidden="true">{letters('The', 0)}</span>{' '}
      <i aria-hidden="true">{letters('Edition', 3)}</i>
    </Tag>
  );
}

/** How much of this paper you've read, as a ring that fills. */
function Ring({ read, total, size = 38 }) {
  const len = 2 * Math.PI * 15;
  const f = total ? Math.min(1, read / total) : 0;
  return (
    <svg className={e.ring} viewBox="0 0 36 36" width={size} height={size} aria-hidden="true" style={{ '--len': `${len}px` }}>
      <circle cx="18" cy="18" r="15" className={e.ringTrack} />
      <circle cx="18" cy="18" r="15" className={e.ringFill} style={{ strokeDasharray: `${len}px`, strokeDashoffset: `${len * (1 - f)}px` }} />
    </svg>
  );
}

function Nameplate({ paper, read, total, plateRef }) {
  const edited = paper.status === 'edited';
  const done = total > 0 && read >= total;
  return (
    <header className={e.nameplate} ref={plateRef}>
      <div className={e.plate}>
        <div className={e.ear}>
          <b>No {paper.issue}</b>
          <span>{longDate(paper.date)}</span>
          <span className={e.earSmall}>composed {hhmm(paper.generated_at)}</span>
        </div>
        <Title />
        <div className={`${e.ear} ${e.earRight}`}>
          <span className={e.reading}>
            {done ? (
              <span className={e.stamp} role="img" aria-label="Finished reading">
                <b lang="ja">読了</b>
                <span>read</span>
              </span>
            ) : (
              <Ring read={read} total={total} />
            )}
            <span className={e.readingText}>
              <b>{done ? 'All read' : `${read} of ${total}`}</b>
              <span>{done ? 'that’s the paper' : 'stories read'}</span>
            </span>
          </span>
          {edited ? (
            <span className={e.earSmall}>written by {paper.model}</span>
          ) : (
            <Link to="/settings?s=edition" className={`${e.earSmall} ${e.wireMark}`} title="No model wrote this paper, so it’s headlines only. Click for the Edition’s settings.">
              headlines only
            </Link>
          )}
        </div>
      </div>
      <div className={e.rule} aria-hidden="true" />
    </header>
  );
}

function Strip({ paper, archive, older, newer, onDate, isLatest, onRecompose, recomposing, unread, onNext, onMarkAll }) {
  return (
    <nav className={e.strip} aria-label="This paper">
      <div className={e.turns}>
        <button type="button" className={e.turn} onClick={() => older && onDate(older)} disabled={!older} title="The paper before this one ( [ )">
          <ArrowLeft size={14} /> {older ? shortDate(older) : 'first issue'}
        </button>
        <label className={e.issues}>
          <span>Back issues</span>
          <select value={paper.date} onChange={(ev) => onDate(ev.target.value)}>
            {(archive?.length ? archive : [{ date: paper.date }]).map((x) => (
              <option key={x.date} value={x.date}>{shortDate(x.date)}{x.status === 'edited' ? '' : ' · wire'}</option>
            ))}
          </select>
        </label>
        <button type="button" className={e.turn} onClick={() => newer && onDate(newer)} disabled={!newer} title="The paper after this one ( ] )">
          {newer ? shortDate(newer) : 'latest'} <ArrowRight size={14} />
        </button>
      </div>
      <div className={e.tools}>
        <button type="button" className={`${e.tool} ${e.toolMain}`} onClick={onNext} disabled={!unread} title="Jump to the next story you haven't opened (u)">
          <ArrowDown size={14} /> Next unread <kbd>u</kbd>
        </button>
        {unread > 0 && (
          <button type="button" className={e.tool} onClick={onMarkAll} title="Tick every story on this paper as read">
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
        {isLatest && (
          <button type="button" className={e.tool} onClick={onRecompose} disabled={recomposing} title="Compose today's paper again from the latest signals">
            <RefreshCw size={14} className={recomposing ? e.spin : ''} /> {recomposing ? 'Recomposing…' : 'Recompose'}
          </button>
        )}
        <Link to="/settings?s=edition" className={e.toolIcon} title="The Edition's settings" aria-label="The Edition's settings">
          <Settings2 size={15} />
        </Link>
      </div>
    </nav>
  );
}

/** The slim bar that follows you down the page once the nameplate has gone by. */
function FollowBar({ show, paper, read, total, unread, onNext }) {
  return (
    <div className={e.followWrap}>
      <div className={`${e.follow} ${show ? e.followOn : ''}`} inert={!show}>
        <Title as="span" className={e.followName} />
        <span className={e.followNo}>No {paper.issue}</span>
        <span className={e.followBar} aria-hidden="true"><i style={{ transform: `scaleX(${total ? read / total : 0})` }} /></span>
        <span className={e.followCount}>{read}/{total}</span>
        <button type="button" className={`${e.tool} ${e.toolMain}`} onClick={onNext} disabled={!unread}>
          <ArrowDown size={14} /> Next unread <kbd>u</kbd>
        </button>
        <button
          type="button"
          className={e.toolIcon}
          onClick={() => window.scrollTo({ top: 0, behavior: scrollMotion() })}
          title="Back to the top"
          aria-label="Back to the top"
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}

// ── before the paper ─────────────────────────────────────────────────────────

function PressesWarming({ hour, onCompose, composing }) {
  return (
    <div className={e.warming}>
      <Title />
      <div className={e.type} aria-hidden="true">
        {[86, 64, 92, 48].map((w, i) => <i key={i} style={{ '--w': `${w}%`, '--i': i }} />)}
      </div>
      <p className={e.warmingSlug}><span className={e.warmingDot} /> the presses are warming</p>
      <p className={e.warmingLine}>
        Your first paper is composed from today's signals{hour != null ? ` after ${String(hour).padStart(2, '0')}:00` : ''}.
      </p>
      <button type="button" className={`${e.tool} ${e.toolMain}`} onClick={onCompose} disabled={composing}>
        <RefreshCw size={14} className={composing ? e.spin : ''} /> {composing ? 'Composing…' : 'Compose now'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={e.skel} aria-hidden="true">
      <div className={e.skelPlate}><Title as="span" /></div>
      <div className={e.skelFront}>
        <div>
          <i style={{ width: '24%' }} /><b /><b style={{ width: '64%' }} />
          <div className={e.skelSpread}><div className={e.skelPic} /><div><i /><i style={{ width: '80%' }} /><i style={{ width: '55%' }} /></div></div>
        </div>
        <div><i style={{ width: '40%' }} /><b /><i /><i style={{ width: '70%' }} /><i style={{ width: '40%' }} /><b /><i /></div>
      </div>
    </div>
  );
}

// ── the paper ────────────────────────────────────────────────────────────────

/** Stories settle in as they scroll into view — and anything added later (In
 *  Brief's "more") too. Still screens get everything at once. */
function useReveal(rootRef, key) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const show = (el) => el.setAttribute('data-shown', '');
    const pending = () => root.querySelectorAll('[data-reveal]:not([data-shown])');
    if (isStill() || typeof IntersectionObserver === 'undefined') {
      pending().forEach(show);
      const mo = new MutationObserver(() => pending().forEach(show));
      mo.observe(root, { childList: true, subtree: true });
      return () => mo.disconnect();
    }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { show(en.target); io.unobserve(en.target); }
      }
    }, { rootMargin: '0px 0px -32px 0px' });
    const watch = () => pending().forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [rootRef, key]);
}

export default function Edition() {
  const [date, setDate] = useParamState('d', '');
  const paperReq = useApi(date ? `/edition/${date}` : '/edition/latest');
  const archive = useApi('/edition/archive');
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);
  const [recomposing, setRecomposing] = useState(false);
  const [buildHour, setBuildHour] = useState(null);
  const [turn, setTurn] = useState('unfold'); // how the next paper arrives: unfold | back | fwd
  const [stuck, setStuck] = useState(false);
  const paperRef = useRef(null);
  const plateRef = useRef(null);

  const paper = paperReq.data;
  const noPaper = paperReq.error === 'no edition yet';
  const archiveList = archive.data?.editions;
  const dates = (archiveList || []).map((x) => x.date);
  const isLatest = !date || date === dates[0];
  const idx = paper ? dates.indexOf(paper.date) : -1;
  const older = idx >= 0 ? dates[idx + 1] || null : null;
  const newer = idx > 0 ? dates[idx - 1] : null;
  const [marks, mark, markMany] = useReadMarks(paper?.date);
  const paperKey = paper ? `${paper.date}:${paper.generated_at}` : '';

  const touched = (it) => mark(it?.id);
  // A back issue can hold stories from a room removed since; those open at the source.
  const play = (it) => (hasModule('youtube') ? playVideo(it) : openOutside(it));
  const showPost = (it) => (hasModule('reddit') ? setPost(it) : openOutside(it));
  const showThread = (it) => (hasModule('hackernews') ? setThread(it) : openOutside(it));
  const on = {
    touched,
    play: (it) => { touched(it); play(it); },
    post: (it) => { touched(it); showPost(it); },
    discuss: (it) => { touched(it); showThread(it); },
    open: (it) => {
      if (!it) return;
      touched(it);
      if (it.platform === 'youtube') play(it);
      else if (it.platform === 'reddit') showPost(it);
      else showThread(it);
    },
  };

  const recompose = async () => {
    try {
      await api('/edition/rebuild', { method: 'POST' });
      setTurn('unfold');
      setRecomposing(true);
    } catch { /* best-effort */ }
  };

  // While a build is in flight (or the first paper hasn't landed), watch the
  // presses; when they stop, the fresh paper unfolds in. Only a build this page
  // hasn't seen yet reloads it: reloading clears the error for a moment, which
  // restarts this watcher, and an unconditional reload would go round forever.
  const reload = paperReq.reload;
  const reloadArchive = archive.reload;
  const seenBuild = useRef(null);
  useEffect(() => {
    if (seenBuild.current == null && archiveList?.[0]) seenBuild.current = archiveList[0].built_at;
  }, [archiveList]);
  useEffect(() => {
    if (!recomposing && !noPaper) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api('/edition/status');
        if (!alive) return;
        if (st.hour != null) setBuildHour(st.hour);
        if (st.building || !st.latest) return; // still printing, or nothing yet
        setRecomposing(false);
        if (st.latest.built_at !== seenBuild.current) {
          seenBuild.current = st.latest.built_at;
          reload();
          reloadArchive();
        }
      } catch { /* keep watching */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [recomposing, noPaper, reload, reloadArchive]);

  // Turning to another paper: back to the top, and it swings in from its side.
  const goDate = useCallback((d) => {
    if (!d || d === paper?.date) return;
    setTurn(paper && d < paper.date ? 'back' : 'fwd');
    setDate(d === dates[0] ? '' : d);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: scrollMotion() });
  }, [paper, dates, setDate]);

  const columns = paper?.columns || [];
  const rail = columns.slice(0, 2);
  const row = columns.slice(2);
  const everyStory = paper ? [paper.lede, ...columns, ...(paper.briefs || [])].filter(Boolean) : [];
  const topId = (st) => st?.items?.[0]?.id;
  const readCount = everyStory.filter((st) => marks.has(topId(st))).length;
  const unread = everyStory.length - readCount;
  const isRead = (st) => marks.has(topId(st));

  useReveal(paperRef, paperKey);

  // The follow bar shows once the nameplate has scrolled away above.
  useEffect(() => {
    const el = plateRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([en]) => setStuck(!en.isIntersecting && en.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [paperKey]);

  /** Jump to the next story you haven't opened: the first after the one you're on,
   *  else the first below the top of the screen, else back round to the first. */
  const nextUnread = useCallback(() => {
    const root = paperRef.current;
    if (!root) return;
    const els = [...root.querySelectorAll('[data-unread]')].filter((el) => el.offsetParent !== null);
    if (!els.length) return;
    const cur = document.activeElement;
    const onStory = cur && root.contains(cur) ? cur.closest('[data-story]') : null;
    const target = (onStory && els.find((el) => el !== onStory && (onStory.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)))
      || els.find((el) => el.getBoundingClientRect().top > 90)
      || els[0];
    target.scrollIntoView({ block: 'center', behavior: scrollMotion() });
    target.focus({ preventScroll: true });
    target.removeAttribute('data-flash');
    void target.offsetWidth; // restart the glow if it's still on from last time
    target.setAttribute('data-flash', '');
    setTimeout(() => target.removeAttribute('data-flash'), 1400);
  }, []);

  const markAll = () => markMany(everyStory.map(topId));

  // u · [ · ] — standing down while typing, while a reader or the player is open.
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.defaultPrevented) return;
      if (document.body.dataset.playerExpanded || document.body.dataset.editorFocused || post || thread) return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (ev.key === 'u') { ev.preventDefault(); nextUnread(); }
      else if (ev.key === '[' && older) { ev.preventDefault(); goDate(older); }
      else if (ev.key === ']' && newer) { ev.preventDefault(); goDate(newer); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextUnread, goDate, older, newer, post, thread]);

  return (
    <div className={e.room}>
      {paperReq.error && !noPaper && <ErrorBox message={paperReq.error} />}
      {noPaper && <PressesWarming hour={buildHour} onCompose={recompose} composing={recomposing} />}
      {paperReq.loading && !paper && !noPaper && <Skeleton />}

      {paper && (
        <div key={paperKey} ref={paperRef} className={`${e.paper} ${e[turn]} ${recomposing ? e.pressing : ''}`}>
          <FollowBar show={stuck} paper={paper} read={readCount} total={everyStory.length} unread={unread} onNext={nextUnread} />
          <Nameplate paper={paper} read={readCount} total={everyStory.length} plateRef={plateRef} />
          <Strip
            paper={paper}
            archive={archiveList}
            older={older}
            newer={newer}
            onDate={goDate}
            isLatest={isLatest}
            onRecompose={recompose}
            recomposing={recomposing}
            unread={unread}
            onNext={nextUnread}
            onMarkAll={markAll}
          />

          <div className={`${e.front} ${rail.length ? '' : e.frontSolo}`}>
            {paper.lede && <Lede story={paper.lede} on={on} read={isRead(paper.lede)} />}
            {rail.length > 0 && (
              <aside className={e.rail} aria-label="Also on the front">
                <h2 className={e.railHead}>Also on the front</h2>
                {rail.map((st, i) => (
                  <Story key={topId(st) || i} story={st} on={on} read={isRead(st)} variant="rail" index={i + 1} />
                ))}
              </aside>
            )}
          </div>

          {row.length > 0 && (
            <div className={e.row} data-n={Math.min(row.length, 3)}>
              {row.map((st, i) => (
                <Story key={topId(st) || i} story={st} on={on} read={isRead(st)} index={i} />
              ))}
            </div>
          )}

          <Briefs briefs={paper.briefs || []} on={on} marks={marks} />

          <footer className={e.colophon}>
            <div className={e.colTurns}>
              {older ? (
                <button type="button" className={e.turn} onClick={() => goDate(older)}><ArrowLeft size={14} /> The paper before · {shortDate(older)}</button>
              ) : <span />}
              {newer ? (
                <button type="button" className={e.turn} onClick={() => goDate(newer)}>The paper after · {shortDate(newer)} <ArrowRight size={14} /></button>
              ) : <span className={e.colNote}>this is the latest paper</span>}
            </div>
            <div className={e.colLine}>
              <span>No {paper.issue} · composed {hhmm(paper.generated_at)} in {(paper.build_ms / 1000).toFixed(1)}s from the last {paper.window_h || 36} hours · nothing left this machine</span>
              <span className={e.colKeys}><kbd>u</kbd> next unread · <kbd>[</kbd><kbd>]</kbd> turn the page · <kbd>j</kbd><kbd>k</kbd> walk the stories</span>
            </div>
          </footer>

          {recomposing && <div className={e.press} aria-hidden="true"><i /></div>}
        </div>
      )}

      <Suspense fallback={null}>
        {post && <RedditPostModal item={post} onClose={() => setPost(null)} />}
        {thread && <ReaderSheet item={thread} onClose={() => setThread(null)} onItem={(id) => setThread({ id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } })} />}
      </Suspense>
    </div>
  );
}
