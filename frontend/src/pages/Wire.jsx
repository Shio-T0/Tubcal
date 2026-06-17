import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox, Receiving, SearchBar, SectionHead, useDebounced } from '../components/layout/Section.jsx';
import HNCommentsPanel from '../components/modals/HNCommentsPanel.jsx';
import { Button, IconButton, SegmentedControl } from '../components/ui/index.jsx';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { useSettings } from '../state.jsx';
import s from './wire.module.css';

function WireRow({ item, index, onComments }) {
  return (
    <div className={s.row} style={{ '--i': index % 30 }} onClick={() => onComments(item)}>
      <span className={s.rank}>{String(index + 1).padStart(2, '0')}</span>
      <div className={s.rowMain}>
        <span className={s.rowTitle}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {item.title}
          </a>
          {item.extra.domain && <span className={s.domain}>({item.extra.domain})</span>}
        </span>
        <div className={s.rowMeta}>
          {item.author} · {timeAgo(item.published_at)}
        </div>
      </div>
      <div className={s.stats}>
        <span className={s.points}>▲ {compact(item.score) ?? '–'}</span>
        <span className={s.comments}>{compact(item.comments_count) ?? 0} cmt</span>
      </div>
    </div>
  );
}

export default function Wire() {
  const { settings, updateSettings } = useSettings();
  const list = settings?.hn_list || 'top';
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounced(query.trim());
  const searching = debouncedQ.length >= 2;

  const [items, setItems] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [thread, setThread] = useState(null);

  const search = useApi(`/hackernews/search?q=${encodeURIComponent(debouncedQ)}`, searching);

  const load = useCallback(
    async (p, append) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const d = await api(`/feed/hackernews?list=${list}&page=${p}`);
        setItems((prev) => (append && prev ? [...prev, ...d.items] : d.items));
        setHasMore(d.has_more);
        setPage(p);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [list],
  );

  useEffect(() => {
    setItems(null);
    load(0, false);
  }, [load]);

  const refresh = async () => {
    try {
      await api('/refresh?scope=hackernews', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    load(0, false);
  };

  const shown = searching ? search.data?.items : items;
  const isLoading = searching ? search.loading && !search.data : loading && !items;
  const shownError = searching ? search.error : error;

  return (
    <>
      <SectionHead
        kicker="No 04 — The Wire"
        title="Tonight's teletype"
        note="The orange site, retyped. Click a line for the discussion; the headline goes to the source."
        color="var(--c-hn)"
      >
        <SegmentedControl
          options={['top', 'best', 'new']}
          value={list}
          onChange={(v) => updateSettings({ hn_list: v })}
        />
        <IconButton title="Refresh" onClick={refresh} spinning={loading}>
          <RefreshCw size={16} />
        </IconButton>
      </SectionHead>

      <SearchBar value={query} onChange={setQuery} placeholder="search the wire archive…" />

      {shownError && <ErrorBox message={shownError} />}
      {isLoading && <Receiving label="tuning the teletype" />}

      {shown && (
        <div className={s.board}>
          <div className={s.boardHead}>
            {searching ? `wire archive — “${debouncedQ}”` : `hn wire — ${list} stories`}
            <span className={s.boardHeadMeta}>
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} local
            </span>
          </div>
          {shown.map((item, i) => (
            <WireRow key={item.id} item={item} index={i} onComments={setThread} />
          ))}
        </div>
      )}

      {!searching && items && hasMore && (
        <div className={s.more}>
          <Button variant="ghost" onClick={() => load(page + 1, true)} disabled={loadingMore}>
            {loadingMore ? 'feeding paper…' : 'more from the wire'}
          </Button>
        </div>
      )}

      <HNCommentsPanel item={thread} onClose={() => setThread(null)} />
    </>
  );
}
