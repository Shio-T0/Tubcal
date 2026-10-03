// Search — one box over everything. "Everything" asks every source at once and
// shows the best few from each; a scope chip narrows to one and pages through it
// (YouTube, anime, Hacker News, Reddit, GitHub). Recent searches are kept on the
// phone, one tap to repeat, long-press to forget.

import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Search as SearchIcon, X } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';

import { AppBar, Chips, Empty, ErrorNote, Loading, SectionTitle, Sentinel, Skeleton, useLongPress } from '../shell/Shell.jsx';
import { Poster } from './animeKit.jsx';
import { useOpener } from './discuss.jsx';
import { VideoRow } from './video.jsx';
import r from './search.module.css';

const SCOPES = [
  { key: 'all', label: 'Everything' },
  { key: 'videos', label: 'YouTube' },
  { key: 'anime', label: 'Anime' },
  { key: 'hn', label: 'Hacker News' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'github', label: 'GitHub' },
];
const RECENT = 'tubcal.phone.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } };

function TextHit({ item, onOpen }) {
  const meta = item.platform === 'hackernews'
    ? [item.extra?.domain, item.score != null ? `▲ ${compact(item.score)}` : null, item.comments_count != null ? `${compact(item.comments_count)} comments` : null]
    : item.platform === 'reddit'
      ? [item.source, item.score != null ? `▲ ${compact(item.score)}` : null, item.comments_count != null ? `${compact(item.comments_count)} comments` : null]
      : [item.source, item.extra?.language, item.extra?.stars != null ? `★ ${compact(item.extra.stars)}` : null];
  return (
    <button type="button" className={r.hit} onClick={(e) => onOpen(item, e.currentTarget)} data-reveal style={{ '--c': `var(--c-${item.platform === 'hackernews' ? 'hn' : item.platform})` }}>
      <b>{item.title}</b>
      {item.platform === 'github' && item.extra?.description && <span className={r.desc}>{item.extra.description}</span>}
      <span className={r.meta}>{[...meta, item.published_at ? ago(item.published_at) : null].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

function RecentRow({ q, onPick, onForget }) {
  const lp = useLongPress(() => onForget(q));
  return (
    <div className={r.recentRow} data-reveal="side">
      <button type="button" onClick={() => onPick(q)} {...lp}><History size={17} /> {q}</button>
      <button type="button" className={r.forget} onClick={() => onForget(q)} aria-label={`Forget ${q}`}><X size={16} /></button>
    </div>
  );
}

function Recent({ list, onPick, onForget }) {
  return (
    <div className={r.recent}>
      {list.map((q) => <RecentRow key={q} q={q} onPick={onPick} onForget={onForget} />)}
    </div>
  );
}
/** Paged YouTube search (continuation tokens). */
function useVideoSearch(q) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!q) { setPages([]); return undefined; }
    let alive = true;
    setLoading(true); setError(null); setPages([]);
    api(`/youtube/search?q=${encodeURIComponent(q)}&page=1`)
      .then((d) => { if (alive) { setPages([d]); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [q]);
  const last = pages[pages.length - 1];
  const items = useMemo(() => {
    const seen = new Set();
    return pages.flatMap((p) => p.items || []).filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  }, [pages]);
  const loadMore = () => {
    if (!last?.has_more || more) return;
    const cont = last.continuation ? `&continuation=${encodeURIComponent(last.continuation)}` : '';
    setMore(true);
    api(`/youtube/search?q=${encodeURIComponent(q)}&page=${(last.page || pages.length) + 1}${cont}`)
      .then((d) => setPages((p) => [...p, d])).catch(() => {}).finally(() => setMore(false));
  };
  return { items, loading, more, error, hasMore: !!last?.has_more, loadMore };
}

function AnimeResults({ q }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const res = useApi(`/anime/search?q=${encodeURIComponent(q)}&page=${page}`, !!q);
  useEffect(() => { setPage(1); setItems([]); }, [q]);
  useEffect(() => {
    if (!res.data) return;
    setItems((prev) => (page === 1 ? res.data.items : [...prev, ...res.data.items.filter((x) => !prev.some((y) => y.id === x.id))]));
  }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {res.error && <ErrorNote message={res.error} />}
      {res.loading && !items.length && <Skeleton kind="posters" n={9} />}
      {res.data && !items.length && <Empty Icon={SearchIcon} title="No anime" text={`Nothing on AniList matches “${q}”.`} />}
      <div className={r.wall}>{items.map((m) => <Poster key={m.id} media={m} />)}</div>
      <Sentinel onReach={() => setPage((p) => p + 1)} active={!!res.data?.has_next && !res.loading} />
    </>
  );
}

export default function Search() {
  const [scope, setScope] = useParamState('in', 'all');
  const [q, setQ] = useParamState('q', '');
  const [text, setText] = useState(q);
  const dq = useDebounced(text.trim(), 450);
  const [recent, setRecent] = useState(loadRecent);
  const input = useRef(null);
  const [open, pages] = useOpener();

  useEffect(() => { if (dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!q) input.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (s) => {
    const next = [s, ...recent.filter((x) => x !== s)].slice(0, 12);
    setRecent(next);
    try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* fine */ }
  };
  useEffect(() => { if (q.length >= 2) { const t = setTimeout(() => remember(q), 1500); return () => clearTimeout(t); } return undefined; }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const forget = (s) => {
    const next = recent.filter((x) => x !== s);
    setRecent(next);
    try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* fine */ }
  };

  const live = q.length >= 2;
  const all = useApi(`/search/all?q=${encodeURIComponent(q)}`, live && scope === 'all');
  const allAnime = useApi(`/anime/search?q=${encodeURIComponent(q)}&page=1`, live && scope === 'all');
  const vids = useVideoSearch(live && scope === 'videos' ? q : '');
  const hn = useApi(`/hackernews/search?q=${encodeURIComponent(q)}`, live && scope === 'hn');
  const rd = useApi(`/reddit/search?q=${encodeURIComponent(q)}`, live && scope === 'reddit');
  const gh = useApi(`/github/search?q=${encodeURIComponent(q)}`, live && scope === 'github');
  const one = { hn, reddit: rd, github: gh }[scope];

  const a = all.data || {};
  const anyAll = live && scope === 'all' && all.data && ['youtube', 'reddit', 'hackernews', 'github'].some((k) => a[k]?.length);

  return (
    <div className={r.screen}>
      <AppBar
        title={
          <label className={r.box}>
            <SearchIcon size={18} />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search everything…"
              enterKeyHint="search"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); if (text.trim()) { setQ(text.trim()); remember(text.trim()); } } }}
            />
            {text && <button type="button" onClick={() => { setText(''); input.current?.focus(); }} aria-label="Clear"><X size={17} /></button>}
          </label>
        }
        back
        backTo="/more"
      >
        <Chips items={SCOPES} value={scope} onChange={setScope} />
      </AppBar>

      {!live && (
        recent.length ? (
          <>
            <SectionTitle action="clear" onAction={() => { setRecent([]); try { localStorage.removeItem(RECENT); } catch { /* fine */ } }}>Recent</SectionTitle>
            <Recent list={recent} onPick={(s) => setText(s)} onForget={forget} />
          </>
        ) : <Empty Icon={SearchIcon} title="Search Tubcal" text="Videos, anime, Hacker News, Reddit and GitHub — all from one box." />
      )}

      {live && scope === 'all' && (
        <>
          {all.loading && !all.data && <Skeleton kind="rows" n={4} />}
          {a.youtube?.length > 0 && (
            <>
              <SectionTitle action="more" onAction={() => setScope('videos')}>YouTube</SectionTitle>
              {a.youtube.slice(0, 5).map((it) => <VideoRow key={it.id} item={it} />)}
            </>
          )}
          {allAnime.data?.items?.length > 0 && (
            <>
              <SectionTitle action="more" onAction={() => setScope('anime')}>Anime</SectionTitle>
              <div className={r.strip}>{allAnime.data.items.slice(0, 10).map((m) => <Poster key={m.id} media={m} />)}</div>
            </>
          )}
          {a.hackernews?.length > 0 && (
            <>
              <SectionTitle action="more" onAction={() => setScope('hn')}>Hacker News</SectionTitle>
              {a.hackernews.slice(0, 5).map((it) => <TextHit key={it.id} item={it} onOpen={open} />)}
            </>
          )}
          {a.reddit?.length > 0 && (
            <>
              <SectionTitle action="more" onAction={() => setScope('reddit')}>Reddit</SectionTitle>
              {a.reddit.slice(0, 5).map((it) => <TextHit key={it.id} item={it} onOpen={open} />)}
            </>
          )}
          {a.github?.length > 0 && (
            <>
              <SectionTitle action="more" onAction={() => setScope('github')}>GitHub</SectionTitle>
              {a.github.slice(0, 5).map((it) => <TextHit key={it.id} item={it} onOpen={open} />)}
            </>
          )}
          {all.data && !anyAll && !allAnime.data?.items?.length && !allAnime.loading && <Empty Icon={SearchIcon} title="Nothing found" text={`No room has anything for “${q}”.`} />}
        </>
      )}

      {live && scope === 'videos' && (
        <>
          {vids.error && <ErrorNote message={vids.error} />}
          {vids.loading && <Skeleton kind="rows" n={5} />}
          {!vids.loading && !vids.error && !vids.items.length && <Empty Icon={SearchIcon} title="No videos" text={`YouTube has nothing for “${q}”.`} />}
          {vids.items.map((it) => <VideoRow key={it.id} item={it} />)}
          <Sentinel onReach={vids.loadMore} active={vids.hasMore && !vids.more} />
          {vids.more && <Loading label="more results" />}
        </>
      )}
      {live && scope === 'anime' && <AnimeResults q={q} />}
      {live && one && (
        <>
          {one.error && <ErrorNote message={one.error} />}
          {one.loading && !one.data && <Skeleton kind="lines" n={5} />}
          {one.data && !one.data.items?.length && <Empty Icon={SearchIcon} title="Nothing found" text={`Nothing matches “${q}”.`} />}
          {one.data?.items?.map((it) => <TextHit key={it.id} item={it} onOpen={open} />)}
        </>
      )}
      {pages}
    </div>
  );
}
