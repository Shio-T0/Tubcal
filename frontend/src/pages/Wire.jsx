// The Wire. Hacker News, set on a teletype board.
//
// No title or blurb: a control bar (the six front-page lists, a search of the
// whole archive with newest-first and a time window) over the board. Each line
// is one story — rank, headline (straight to the article), where it's from, who
// and when, points with a little heat gauge (points per hour, so a rising story
// reads hot), and the comment count, which says how many arrived since you last
// read the thread. Stories you've read go quiet.
//
// Open a line and its discussion sits beside the board in the reader (a sheet
// over it when the column is narrow); the open story is `?s=` and pushes
// history, so Back closes it. List, search, order and window live in the URL too.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Briefcase, Clock, Flame, HelpCircle, MessageSquare, RefreshCw, Rocket, Search, Sparkles, Star, TrendingUp, X,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox, Receiving, useDebounced } from '../components/layout/Section.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { HNReader, ReaderSheet, splitKind } from '../components/wire/HNReader.jsx';
import { useWireSeen } from '../components/wire/seen.js';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { latestParams, useParamState } from '../lib/urlState.js';
import { useSettings } from '../state.jsx';
import s from './wire.module.css';

const LISTS = [
  { key: 'top', label: 'Top', Icon: TrendingUp },
  { key: 'best', label: 'Best', Icon: Star },
  { key: 'new', label: 'New', Icon: Sparkles },
  { key: 'ask', label: 'Ask', Icon: HelpCircle },
  { key: 'show', label: 'Show', Icon: Rocket },
  { key: 'job', label: 'Jobs', Icon: Briefcase },
];
const RANGES = [['all', 'any time'], ['day', 'past day'], ['week', 'past week'], ['month', 'past month'], ['year', 'past year']];

/** Points per hour since posting, as a 0–1 "how hot" reading. */
function heatOf(item) {
  if (!item.score || !item.published_at) return 0;
  const hours = Math.max(1, (Date.now() / 1000 - item.published_at) / 3600);
  return Math.min(1, item.score / hours / 60);
}

function useWidth(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Line({ item, rank, open, onOpen, seen, fresh, compactMode }) {
  const read = !!seen;
  const { kind, rest } = splitKind(item.title);
  const heat = heatOf(item);
  const domain = item.extra?.domain;
  const linkOut = item.url && !item.url.includes('news.ycombinator.com/item');
  return (
    <div
      className={`${s.line} ${read ? s.lineRead : ''} ${open ? s.lineOpen : ''}`}
      data-kbd-tile
      tabIndex={0}
      role="button"
      aria-current={open ? 'true' : undefined}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); } }}
    >
      <span className={s.rank}>{String(rank).padStart(2, '0')}</span>
      <div className={s.main}>
        <div className={s.headline}>
          {kind && <span className={s.kind}>{kind}</span>}
          {linkOut ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open the article">
              {rest}
            </a>
          ) : (
            <span>{rest}</span>
          )}
        </div>
        <div className={s.meta}>
          {domain && <span className={s.domain}>{domain}</span>}
          {!compactMode && item.author && <span>{item.author}</span>}
          {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
          {read && <span className={s.readMark}>read</span>}
        </div>
      </div>
      <div className={s.nums}>
        <span className={s.points} title={`${item.score ?? 0} points`}>
          {heat > 0.6 && <Flame size={12} className={s.flame} />}
          <b>{compact(item.score) ?? '–'}</b>
          <span className={s.gauge} aria-hidden="true"><i style={{ width: `${Math.max(6, heat * 100)}%` }} /></span>
        </span>
        <span className={s.cmts} title={`${item.comments_count ?? 0} comments`}>
          <MessageSquare size={13} /> {compact(item.comments_count) ?? 0}
          {fresh > 0 && <em className={s.freshN}>+{compact(fresh)}</em>}
        </span>
      </div>
      <div className={s.acts} onClick={(e) => e.stopPropagation()}>
        <SaveButton item={item} className={s.save} />
      </div>
    </div>
  );
}

export default function Wire() {
  const { settings, updateSettings } = useSettings();
  const [params, setParams] = useSearchParams();
  const [list, setListParam] = useParamState('l', settings?.hn_list || 'top');
  const [q, setQ] = useParamState('q', '');
  const [by, setBy] = useParamState('by', 'relevance');
  const [range, setRange] = useParamState('t', 'all');
  const openId = Number(params.get('s')) || null;
  const known = useRef(new Map()); // hn_id → item, so the reader's header is instant
  const roomRef = useRef(null);
  const width = useWidth(roomRef);
  const split = width >= 980;
  const { seen, newSince } = useWireSeen();

  const [text, setText] = useState(q);
  const dq = useDebounced(text.trim(), 400);
  useEffect(() => { if (dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q !== dq) setText(q); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const searching = q.length >= 2;

  const [items, setItems] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const search = useApi(
    `/hackernews/search?q=${encodeURIComponent(q)}${by === 'date' ? '&sort=date' : ''}${range !== 'all' ? `&range=${range}` : ''}`,
    searching,
  );

  const load = useCallback(async (p, append) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const d = await api(`/feed/hackernews?list=${list}&page=${p}`);
      setItems((prev) => (append && prev ? [...prev, ...d.items.filter((x) => !prev.some((y) => y.id === x.id))] : d.items));
      setHasMore(d.has_more);
      setPage(p);
      setFetchedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [list]);

  useEffect(() => {
    setItems(null);
    load(0, false);
  }, [load]);

  // More as the board nears its end.
  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || searching || !hasMore || loadingMore) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) load(page + 1, true); }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [searching, hasMore, loadingMore, page, load]);

  const refresh = async () => {
    try { await api('/refresh?scope=hackernews', { method: 'POST' }); } catch { /* best-effort */ }
    if (searching) search.reload(); else load(0, false);
  };
  const setList = (k) => {
    setListParam(k);
    updateSettings({ hn_list: k }); // the Wire opens on the list you last read
  };

  const openStory = (item) => {
    const id = item.extra?.hn_id;
    if (!id) return;
    known.current.set(id, item);
    const p = latestParams();
    if (Number(p.get('s')) === id) return;
    const replace = !!p.get('s'); // moving between stories doesn't stack history
    p.set('s', String(id));
    setParams(p, { replace });
  };
  const openById = (id) => {
    const p = latestParams();
    p.set('s', String(id));
    setParams(p);
  };
  const closeStory = useCallback(() => {
    const p = latestParams();
    p.delete('s');
    setParams(p, { replace: true });
  }, [setParams]);

  const shown = searching ? search.data?.items : items;
  const isLoading = searching ? search.loading && !search.data : loading && !items;
  const shownError = searching ? search.error : error;
  const openItem = openId ? known.current.get(openId) || (shown || []).find((i) => i.extra?.hn_id === openId) : null;
  const listMeta = LISTS.find((l) => l.key === list) || LISTS[0];

  return (
    <div className={s.room} ref={roomRef}>
      <div className={s.bar}>
        <nav className={s.lists} aria-label="Lists">
          {LISTS.map(({ key, label, Icon }) => {
            const on = !searching && list === key;
            return (
              <button key={key} type="button" className={`${s.list} ${on ? s.listOn : ''}`} onClick={() => { setText(''); setQ(''); setList(key); }} aria-pressed={on}>
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </nav>
        <label className={s.search}>
          <Search size={15} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.preventDefault(); setText(''); } }}
            placeholder="Search every story on HN…"
            spellCheck={false}
          />
          {text && <button type="button" onClick={() => setText('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <button type="button" className={s.refresh} onClick={refresh} title="Refresh the wire" aria-label="Refresh">
          <RefreshCw size={15} className={loading || search.loading ? s.spin : ''} />
        </button>
      </div>

      {searching && (
        <div className={s.filters}>
          <div className={s.seg} role="group" aria-label="Order">
            {[['relevance', 'Best match'], ['date', 'Newest']].map(([k, l]) => (
              <button key={k} type="button" className={by === k ? s.segOn : ''} onClick={() => setBy(k)} aria-pressed={by === k}>
                {k === 'date' ? <Clock size={13} /> : null} {l}
              </button>
            ))}
          </div>
          <div className={s.seg} role="group" aria-label="When">
            {RANGES.map(([k, l]) => (
              <button key={k} type="button" className={range === k ? s.segOn : ''} onClick={() => setRange(k)} aria-pressed={range === k}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${s.split} ${openId && split ? s.splitOpen : ''}`}>
        <section className={s.board} aria-label="Stories">
          <header className={s.boardHead}>
            <span className={s.lamp} aria-hidden="true" />
            {searching ? <>wire archive — “{q}”</> : <>hn wire — {listMeta.label.toLowerCase()} {list === 'job' ? 'postings' : 'stories'}</>}
            <span className={s.boardMeta}>
              {searching
                ? `${shown?.length ?? 0} found`
                : fetchedAt ? `set ${new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </header>

          {shownError && <ErrorBox message={shownError} />}
          {isLoading && <Receiving label="tuning the teletype" />}
          {shown && !shown.length && !isLoading && <p className={s.muted}>{searching ? 'Nothing on the wire matches that.' : 'The wire is quiet.'}</p>}

          {shown && shown.map((item, i) => (
            <Line
              key={item.id}
              item={item}
              rank={i + 1}
              open={item.extra?.hn_id === openId}
              onOpen={openStory}
              seen={seen[item.extra?.hn_id]}
              fresh={newSince(item)}
              compactMode={!!openId && split}
            />
          ))}

          {!searching && items && hasMore && (
            <button type="button" ref={sentinel} className={s.more} onClick={() => load(page + 1, true)} disabled={loadingMore}>
              {loadingMore ? 'feeding paper…' : 'more from the wire'}
            </button>
          )}
        </section>

        {openId && split && (
          <aside className={s.pane}>
            <HNReader key={openId} item={openItem} hnId={openId} onClose={closeStory} onItem={openById} />
          </aside>
        )}
      </div>

      {openId && !split && width > 0 && (
        <ReaderSheet item={openItem} hnId={openId} onClose={closeStory} onItem={openById} />
      )}
    </div>
  );
}
