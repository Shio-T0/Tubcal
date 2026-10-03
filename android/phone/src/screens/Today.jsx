// Today — The Edition on a phone.
//
// Same paper, set for one column and a thumb: a small nameplate (issue, date,
// who wrote it, how much you've read), then the lead story full-bleed with its
// picture, the other front-page stories as cards, and In Brief filtered by room
// on chips. Every story opens the phone way — a video plays, a Reddit post or an
// HN discussion slides in — and long-press gives its actions. Back issues are a
// sheet; the previous/next paper sit at the foot of the page. Pull down to fetch
// the paper again; Recompose (latest paper only) asks the presses for a new one.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookmarkCheck, CalendarDays, Check, ExternalLink, FileText, ListPlus, MessageSquare, Newspaper, Play,
  RefreshCw, Share2, Bookmark,
} from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { splitKind } from '@pc/components/wire/HNReader.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { usePlayer, useSaved, useToast } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import {
  ActionSheet, AppBar, Chips, ErrorNote, IconBtn, Sheet, useLongPress, usePullToRefresh,
} from '../shell/Shell.jsx';
import { useOpener } from './discuss.jsx';
import t from './today.module.css';

const ROOM = {
  youtube: { name: 'Screening Room', short: 'Watch', c: 'var(--c-youtube)' },
  reddit: { name: 'The Dispatch', short: 'Reddit', c: 'var(--c-reddit)' },
  hackernews: { name: 'The Wire', short: 'HN', c: 'var(--c-hn)' },
};
const roomOf = (it) => ROOM[it?.platform] || ROOM.hackernews;

// ── what you've read, per paper (shared with the desktop's key) ─────────────

const READ_KEY = 'tubcal.edition.read';
function readAll() {
  try { return JSON.parse(localStorage.getItem(READ_KEY)) || {}; } catch { return {}; }
}
function useReadMarks(date) {
  const [all, setAll] = useState(readAll);
  const marks = useMemo(() => new Set(all[date] || []), [all, date]);
  const mark = useCallback((key) => {
    if (!date || !key) return;
    setAll((prev) => {
      const cur = new Set(prev[date] || []);
      if (cur.has(key)) return prev;
      cur.add(key);
      const next = { ...prev, [date]: [...cur] };
      Object.keys(next).sort().slice(0, -31).forEach((d) => delete next[d]);
      try { localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }, [date]);
  return [marks, mark];
}

function kickerOf(item) {
  if (!item) return '';
  const where = item.platform === 'hackernews'
    ? (splitKind(item.title).kind || item.extra?.domain || 'Hacker News')
    : item.source;
  return `${roomOf(item).name}${where ? ` · ${where}` : ''}`;
}

function numbersOf(item) {
  if (!item) return [];
  const bits = [];
  if (item.platform === 'youtube') {
    if (item.source) bits.push(item.source);
  } else {
    if (item.score != null) bits.push(`▲ ${compact(item.score)}`);
    if (item.comments_count != null) bits.push(`${compact(item.comments_count)} comments`);
  }
  if (item.published_at) bits.push(ago(item.published_at));
  return bits;
}

const isLink = (it) => it?.platform === 'hackernews' && it.url && !it.url.includes('news.ycombinator.com/item');

// ── a story's actions ────────────────────────────────────────────────────────

function StoryMenu({ item, open, onClose, on }) {
  const { enqueue } = usePlayer();
  const { saved, toggleSaved } = useSaved();
  const toast = useToast();
  if (!item) return null;
  const isSaved = !!saved[item.id];
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title={item.title}
      actions={[
        item.platform === 'youtube' && { label: 'Watch', Icon: Play, onClick: () => on.open(item) },
        item.platform === 'youtube' && { label: 'Play next', Icon: ListPlus, onClick: () => { enqueue(item); toast('Queued — plays next', 'success'); } },
        isLink(item) && { label: 'Read the article', Icon: ExternalLink, hint: item.extra?.domain, onClick: () => on.article(item) },
        item.platform === 'hackernews' && { label: 'Discussion', Icon: MessageSquare, onClick: () => on.open(item) },
        item.platform === 'reddit' && { label: 'Read the post', Icon: FileText, onClick: () => on.open(item) },
        { label: isSaved ? 'Remove from Saved' : 'Save for later', Icon: isSaved ? BookmarkCheck : Bookmark, onClick: () => toggleSaved(item) },
        { label: 'Share', Icon: Share2, onClick: () => share({ title: item.title, url: item.url }) },
      ]}
    />
  );
}

/** The buttons under a story: the main door, then the discussion. */
function Doors({ item, on, big }) {
  if (!item) return null;
  const cls = `${t.door} ${big ? t.doorBig : ''}`;
  if (item.platform === 'youtube') {
    return (
      <div className={t.doors}>
        <button type="button" className={`${cls} ${t.doorMain}`} onClick={() => on.open(item)}><Play size={15} fill="currentColor" /> Watch</button>
        <button type="button" className={cls} onClick={() => on.queue(item)}><ListPlus size={16} /> Up next</button>
      </div>
    );
  }
  if (item.platform === 'reddit') {
    return (
      <div className={t.doors}>
        <button type="button" className={`${cls} ${t.doorMain}`} onClick={() => on.open(item)}>
          <FileText size={15} /> Read the post{item.comments_count != null ? ` · ${compact(item.comments_count)}` : ''}
        </button>
      </div>
    );
  }
  const link = isLink(item);
  return (
    <div className={t.doors}>
      {link && <button type="button" className={`${cls} ${t.doorMain}`} onClick={() => on.article(item)}>Article <ExternalLink size={14} /></button>}
      <button type="button" className={`${cls} ${link ? '' : t.doorMain}`} onClick={() => on.open(item)}>
        <MessageSquare size={15} /> {item.comments_count != null ? compact(item.comments_count) : 'Discuss'}
      </button>
    </div>
  );
}

function AlsoOn({ items, on }) {
  const rest = items.slice(1);
  if (!rest.length) return null;
  return (
    <div className={t.also}>
      <span>also on</span>
      {rest.slice(0, 4).map((it) => (
        <button key={it.id} type="button" style={{ '--c': roomOf(it).c }} onClick={() => on.open(it)}>
          {roomOf(it).short}{it.platform === 'reddit' ? ` · ${it.source}` : ''}
        </button>
      ))}
    </div>
  );
}

/** Tapping the headline does the obvious thing: an article opens, a video plays,
 *  a post or a discussion slides in. */
const primary = (item, on) => (isLink(item) ? on.article(item) : on.open(item));

function Lede({ story, on, read, onMenu }) {
  const items = story.items || [];
  const top = items[0];
  const pic = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const [more, setMore] = useState(false);
  const lp = useLongPress(() => onMenu(top));
  const big = pic?.thumbnail?.replace('hqdefault', 'maxresdefault');
  const long = (story.body || '').length > 320;
  return (
    <article className={`${t.lede} ${read ? t.read : ''}`} style={{ '--c': roomOf(top).c }} data-reveal="fade">
      {pic && imgOk && (
        <button type="button" className={t.ledePic} onClick={(e) => on.open(pic, e.currentTarget)} {...lp}>
          <img
            src={big || pic.thumbnail}
            alt=""
            fetchPriority="high"
            onLoad={(ev) => { if (ev.currentTarget.naturalWidth <= 120 && ev.currentTarget.src !== pic.thumbnail) ev.currentTarget.src = pic.thumbnail; }}
            onError={(ev) => { if (ev.currentTarget.src !== pic.thumbnail) ev.currentTarget.src = pic.thumbnail; else setImgOk(false); }}
          />
          {pic.platform === 'youtube' && <span className={t.playMark}><Play size={24} fill="currentColor" /></span>}
        </button>
      )}
      <div className={t.ledeText}>
        <span className={t.kicker}><em>Lead story</em>{read && <Check size={12} />}{kickerOf(top)}</span>
        <h2 className={t.ledeHead}>
          <button type="button" onClick={() => primary(top, on)} {...lp}>{story.headline || top?.title}</button>
        </h2>
        {story.dek ? <p className={t.ledeDek}>{story.dek}</p> : <p className={t.numbers}>{numbersOf(top).map((b) => <span key={b}>{b}</span>)}</p>}
        {story.body && (
          <p className={`${t.body} ${long && !more ? t.bodyClamp : ''}`} onClick={() => setMore(true)}>
            {story.body}
          </p>
        )}
        {long && !more && <button type="button" className={t.moreBtn} onClick={() => setMore(true)}>Read on</button>}
        {story.transcript_of && <p className={t.transcript}><FileText size={12} /> written from what was said in the video</p>}
        <AlsoOn items={items} on={on} />
        <Doors item={top} on={on} big />
      </div>
    </article>
  );
}

function Story({ story, on, read, onMenu, index }) {
  const items = story.items || [];
  const top = items[0];
  const pic = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const lp = useLongPress(() => onMenu(top));
  return (
    <article className={`${t.story} ${read ? t.read : ''}`} style={{ '--c': roomOf(top).c, '--i': index }} data-reveal>
      <span className={t.kicker}>{read && <Check size={12} />}{kickerOf(top)}</span>
      <div className={t.storyMain}>
        <h3 className={t.storyHead}>
          <button type="button" onClick={() => primary(top, on)} {...lp}>{story.headline || top?.title}</button>
        </h3>
        {pic && imgOk && (
          <button type="button" className={t.storyPic} onClick={(e) => on.open(pic, e.currentTarget)} {...lp} aria-hidden="true" tabIndex={-1}>
            <img src={pic.thumbnail} alt="" loading="lazy" onError={() => setImgOk(false)} />
            {pic.platform === 'youtube' && <span className={t.playMarkSm}><Play size={13} fill="currentColor" /></span>}
          </button>
        )}
      </div>
      {story.dek ? <p className={t.dek}>{story.dek}</p> : <p className={t.numbers}>{numbersOf(top).map((b) => <span key={b}>{b}</span>)}</p>}
      {story.body && <p className={`${t.body} ${t.bodyClamp}`}>{story.body}</p>}
      <AlsoOn items={items} on={on} />
      <Doors item={top} on={on} />
    </article>
  );
}

function Brief({ b, on, read, onMenu }) {
  const it = b.items?.[0];
  const lp = useLongPress(() => onMenu(it));
  const meta = it?.platform === 'hackernews'
    ? [it?.extra?.domain, it?.score != null ? `▲ ${compact(it.score)}` : null, it?.comments_count ? `${compact(it.comments_count)} cmt` : null]
    : [it?.source];
  return (
    <li className={read ? t.read : undefined} style={{ '--c': roomOf(it).c }} data-reveal="side">
      <button type="button" className={t.brief} onClick={() => on.open(it)} {...lp}>
        <span className={t.briefHead}>{read && <Check size={12} />}{b.headline}</span>
        <span className={t.briefMeta}>{[...meta, it?.published_at ? ago(it.published_at) : null].filter(Boolean).join(' · ')}</span>
      </button>
    </li>
  );
}

function Briefs({ briefs, on, marks, onMenu }) {
  const [room, setRoom] = useState('all');
  const [cap, setCap] = useState(12);
  const counts = useMemo(() => {
    const m = {};
    for (const b of briefs) { const p = b.items?.[0]?.platform || 'hackernews'; m[p] = (m[p] || 0) + 1; }
    return m;
  }, [briefs]);
  if (!briefs.length) return null;
  const shown = room === 'all' ? briefs : briefs.filter((b) => (b.items?.[0]?.platform || 'hackernews') === room);
  const rooms = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return (
    <section className={t.briefs}>
      <h2 className={t.rule} data-reveal="fade"><span>In brief</span></h2>
      {rooms.length > 1 && (
        <Chips
          items={[{ key: 'all', label: 'Everything', count: briefs.length }, ...rooms.map((r) => ({ key: r, label: (ROOM[r] || ROOM.hackernews).name, count: counts[r] }))]}
          value={room}
          onChange={(k) => { setRoom(k); setCap(12); }}
        />
      )}
      <ol className={t.briefList}>
        {shown.slice(0, cap).map((b) => (
          <Brief key={b.items?.[0]?.id || b.headline} b={b} on={on} read={marks.has(b.items?.[0]?.id)} onMenu={onMenu} />
        ))}
      </ol>
      {shown.length > cap && (
        <button type="button" className={t.moreBriefs} onClick={() => setCap((c) => c + 20)}>{shown.length - cap} more in brief</button>
      )}
    </section>
  );
}

// ── dates ────────────────────────────────────────────────────────────────────

const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function BackIssues({ open, onClose, archive, current, onPick }) {
  return (
    <Sheet open={open} onClose={onClose} title="Back issues">
      <div className={t.issues}>
        {(archive || []).map((x, i) => (
          <button key={x.date} type="button" className={x.date === current ? t.issueOn : ''} onClick={() => { onPick(i === 0 ? '' : x.date); onClose(); }}>
            <b>{i === 0 ? 'Latest' : shortDate(x.date)}</b>
            <span>{longDate(x.date)}</span>
            <em>{x.status === 'edited' ? 'edited' : 'wire'}</em>
            {x.date === current && <Check size={17} />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ── the paper ────────────────────────────────────────────────────────────────

export default function Today() {
  const [date, setDate] = useParamState('d', '');
  const paperReq = useApi(date ? `/edition/${date}` : '/edition/latest');
  const archive = useApi('/edition/archive');
  const { enqueue } = usePlayer();
  const toast = useToast();
  const [recomposing, setRecomposing] = useState(false);
  const [buildHour, setBuildHour] = useState(null);
  const [issues, setIssues] = useState(false);
  const [menu, setMenu] = useState(null);

  const paper = paperReq.data;
  const noPaper = paperReq.error === 'no edition yet';
  const list = archive.data?.editions || [];
  const isLatest = !date || date === list[0]?.date;
  const [marks, mark] = useReadMarks(paper?.date);
  const [openItem, pages] = useOpener({ onOpen: (it) => mark(it?.id) });

  const on = {
    open: openItem,
    article: (it) => { mark(it?.id); openExternal(it.url); },
    queue: (it) => { enqueue(it); toast('Queued — plays next', 'success'); },
  };

  const recompose = async () => {
    try { await api('/edition/rebuild', { method: 'POST' }); setRecomposing(true); } catch { /* best-effort */ }
  };
  const reload = paperReq.reload;
  const reloadArchive = archive.reload;
  useEffect(() => {
    if (!recomposing && !noPaper) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api('/edition/status');
        if (!alive) return;
        if (st.hour != null) setBuildHour(st.hour);
        if (!st.building && st.latest) { setRecomposing(false); reload(); reloadArchive(); }
      } catch { /* keep watching */ }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [recomposing, noPaper, reload, reloadArchive]);

  const pull = usePullToRefresh(async () => { await Promise.allSettled([reload(), reloadArchive()]); });

  const dates = list.map((x) => x.date);
  const idx = paper ? dates.indexOf(paper.date) : -1;
  const older = idx >= 0 ? dates[idx + 1] : null;
  const newer = idx > 0 ? dates[idx - 1] : null;
  const turn = (d) => { setDate(d === dates[0] ? '' : d); window.scrollTo(0, 0); };

  const columns = paper?.columns || [];
  const every = paper ? [paper.lede, ...columns, ...(paper.briefs || [])].filter(Boolean) : [];
  const readCount = every.filter((st) => marks.has(st.items?.[0]?.id)).length;
  const isRead = (st) => marks.has(st?.items?.[0]?.id);
  const edited = paper?.status === 'edited';

  return (
    <div className={t.screen}>
      <AppBar
        title={<h1 className={t.barTitle}>The <i>Edition</i></h1>}
        sub={paper ? `No ${paper.issue} · ${longDate(paper.date)}` : 'today’s paper'}
        tone="var(--signal)"
        actions={
          <>
            {list.length > 1 && <IconBtn label="Back issues" onClick={() => setIssues(true)}><CalendarDays size={21} /></IconBtn>}
            {isLatest && (paper || noPaper) && (
              <IconBtn label="Recompose" onClick={recompose} disabled={recomposing}>
                <RefreshCw size={20} className={recomposing ? t.spin : ''} />
              </IconBtn>
            )}
          </>
        }
      />
      {pull}

      {paperReq.error && !noPaper && <ErrorNote message={paperReq.error} onRetry={reload} />}
      {noPaper && (
        <div className={t.warming}>
          <Newspaper size={40} />
          <p className={t.warmingSlug}><span /> the presses are warming</p>
          <p>Your first paper is composed from today's signals{buildHour != null ? ` after ${String(buildHour).padStart(2, '0')}:00` : ''}.</p>
          <button type="button" className={t.compose} onClick={recompose} disabled={recomposing}>
            <RefreshCw size={16} className={recomposing ? t.spin : ''} /> {recomposing ? 'Composing…' : 'Compose now'}
          </button>
        </div>
      )}
      {paperReq.loading && !paper && !noPaper && (
        <div className={t.skel} aria-hidden="true"><div /><i /><i /><b /></div>
      )}

      {paper && (
        <div key={paper.generated_at} className={t.paper}>
          <div className={t.plate}>
            <span className={edited ? t.edited : t.wire}>{edited ? `written by ${paper.model}` : 'wire edition · headlines only'}</span>
            <span className={t.progress}>
              <span className={t.progressBar}><i style={{ width: `${every.length ? (readCount / every.length) * 100 : 0}%` }} /></span>
              {readCount === every.length && every.length > 0 ? 'all read' : `${readCount}/${every.length} read`}
            </span>
          </div>
          {recomposing && <p className={t.pressing}><RefreshCw size={13} className={t.spin} /> recomposing — the new paper slides in when it's set</p>}

          {paper.lede && <Lede story={paper.lede} on={on} read={isRead(paper.lede)} onMenu={setMenu} />}
          {columns.length > 0 && <h2 className={t.rule} data-reveal="fade"><span>On the front</span></h2>}
          {columns.map((st, i) => (
            <Story key={st.items?.[0]?.id || i} story={st} on={on} read={isRead(st)} onMenu={setMenu} index={i} />
          ))}
          <Briefs briefs={paper.briefs || []} on={on} marks={marks} onMenu={setMenu} />

          <nav className={t.turns} aria-label="Other papers" data-reveal>
            <button type="button" onClick={() => older && turn(older)} disabled={!older}><ArrowLeft size={16} /> {older ? shortDate(older) : 'first issue'}</button>
            {list.length > 1 && <button type="button" onClick={() => setIssues(true)}><CalendarDays size={16} /></button>}
            <button type="button" onClick={() => newer && turn(newer)} disabled={!newer}>{newer ? shortDate(newer) : 'latest'} <ArrowRight size={16} /></button>
          </nav>
          <p className={t.colophon}>
            No {paper.issue} · composed {new Date(paper.generated_at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} in {(paper.build_ms / 1000).toFixed(1)}s from the last {paper.window_h || 36} hours · nothing left this phone
          </p>
        </div>
      )}

      <BackIssues open={issues} onClose={() => setIssues(false)} archive={list} current={paper?.date} onPick={(d) => { setDate(d); window.scrollTo(0, 0); }} />
      <StoryMenu item={menu} open={!!menu} onClose={() => setMenu(null)} on={on} />
      {pages}
    </div>
  );
}
