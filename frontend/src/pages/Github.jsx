import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Star, GitFork, Bug, Plus, TrendingUp, ListTree, Trash2 } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import {
  chipStyles as c,
  ErrorBox,
  Receiving,
  SearchBar,
  SectionHead,
  useDebounced,
} from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import Modal from '../components/modals/Modal.jsx';
import RepoDetailModal from '../components/modals/RepoDetailModal.jsx';
import modalStyles from '../components/modals/Modal.module.css';
import { Avatar } from '../components/ui/Avatar.jsx';
import { Button, IconButton, SegmentedControl } from '../components/ui/index.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { useHorizontalWheel } from '../lib/useHorizontalWheel.js';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { useSubscriptions, useToast } from '../state.jsx';
import s from './github.module.css';
import settingsStyles from './settings.module.css';

function GithubRow({ item, index, onOpen }) {
  const extra = item.extra || {};
  const isRepo = extra.type === 'repo';
  const isRelease = extra.type === 'release';
  const isEvent = extra.type === 'event';
  const canOpenInApp = isRepo || isRelease; // events point at repos too, but keep those external for now

  return (
    <div className={s.row} style={{ '--i': index % 30 }}>
      <div className={s.rowIcon}>
        {isRepo ? <Star size={14} /> : isRelease ? <GitFork size={14} /> : <Bug size={14} />}
      </div>
      <div className={s.rowMain}>
        <span className={s.rowTitle}>
          {canOpenInApp ? (
            <button
              type="button"
              onClick={() => onOpen(item)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {item.title}
            </button>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {item.title}
            </a>
          )}
        </span>
        <div className={s.rowMeta}>
          {item.source && <span className={s.repoName}>{item.source}</span>}
          {item.author && <span> · {item.author}</span>}
          {item.published_at ? <span> · {timeAgo(item.published_at)}</span> : null}
        </div>
        {isRepo && extra.description && (
          <p className={s.description}>{extra.description}</p>
        )}
        {isRepo && (
          <div className={s.tags}>
            {extra.language && <span className={s.langTag}>{extra.language}</span>}
            {extra.stars != null && (
              <span className={s.statTag}>
                <Star size={11} /> {compact(extra.stars)}
              </span>
            )}
            {extra.forks != null && (
              <span className={s.statTag}>
                <GitFork size={11} /> {compact(extra.forks)}
              </span>
            )}
            {extra.topics?.slice(0, 3).map((t) => (
              <span key={t} className={s.topicTag}>{t}</span>
            ))}
          </div>
        )}
        {isRelease && extra.tag && (
          <div className={s.tags}>
            <span className={s.langTag}>{extra.tag}</span>
            {extra.prerelease && <span className={s.preTag}>Pre-release</span>}
          </div>
        )}
        {isEvent && extra.event_type && (
          <div className={s.tags}>
            <span className={s.eventTag}>{extra.event_type}</span>
          </div>
        )}
      </div>
      <div className={s.stats}>
        {item.score != null && <span className={s.stars}>★ {compact(item.score)}</span>}
        {item.comments_count != null && item.comments_count > 0 && (
          <span className={s.issues}>{compact(item.comments_count)} issues</span>
        )}
      </div>
      <span style={{ position: 'relative', alignSelf: 'center' }}>
        <SaveButton item={item} />
      </span>
    </div>
  );
}

function RepoChips({ subs, onAdd, onOpen }) {
  const rowRef = useHorizontalWheel();
  return (
    <div className={c.chips} ref={rowRef} style={{ '--chip-c': 'var(--c-github)' }}>
      {subs.map((sub) => {
        const isRepo = sub.source_id.includes('/');
        const chipInner = (
          <>
            <Avatar
              src={sub.thumbnail}
              name={sub.display_name}
              imgClass={c.chipAvatar}
              letterClass={c.chipLetter}
            />
            {sub.display_name}
          </>
        );
        return isRepo ? (
          <button
            key={sub.id}
            type="button"
            className={c.chip}
            onClick={() => onOpen({ title: sub.display_name, source: sub.source_id, extra: {} })}
          >
            {chipInner}
          </button>
        ) : (
          <a
            key={sub.id}
            href={`https://github.com/${sub.source_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={c.chip}
          >
            {chipInner}
          </a>
        );
      })}
      <button className={`${c.chip} ${c.chipGhost}`} onClick={onAdd}>
        <Plus size={13} /> add repo or user
      </button>
    </div>
  );
}

function ManageSubsModal({ open, onClose, subs, onAdd }) {
  const { refreshSubs } = useSubscriptions();
  const toast = useToast();

  const remove = async (row) => {
    try {
      await api(`/subscriptions/${row.id}`, { method: 'DELETE' });
      toast(`Removed ${row.display_name}`, 'success');
      refreshSubs();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} label="Saved GitHub repos & users" maxWidth={460}>
      <div className={modalStyles.modalBody}>
        <h2 className={modalStyles.modalTitle}>Saved repos & users</h2>
        <div style={{ '--group-c': 'var(--c-github)' }}>
          {subs.length === 0 && (
            <div className={settingsStyles.rowHint} style={{ padding: '8px 0' }}>
              Nothing saved yet.
            </div>
          )}
          {subs.map((row) => (
            <div key={row.id} className={settingsStyles.subRow}>
              <Avatar
                src={row.thumbnail}
                name={row.display_name}
                imgClass={settingsStyles.subRowAvatar}
                letterClass={settingsStyles.subRowAvatarLetter}
              />
              <span className={settingsStyles.subRowName}>{row.display_name}</span>
              <button className={settingsStyles.removeBtn} onClick={() => remove(row)} title="Remove">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            onAdd();
          }}
        >
          <Plus size={14} /> add repo or user
        </Button>
      </div>
    </Modal>
  );
}

export default function Github() {
  const { subs } = useSubscriptions();
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounced(query.trim());
  const searching = debouncedQ.length >= 2;

  const [period, setPeriod] = useState('daily');
  const trending = useApi(`/github/trending?period=${period}`, !searching);

  const [items, setItems] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const search = useApi(`/github/search?q=${encodeURIComponent(debouncedQ)}`, searching);

  const load = useCallback(
    async (p, append) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const d = await api(`/feed/github?page=${p}`);
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
    [],
  );

  useEffect(() => {
    setItems(null);
    load(0, false);
  }, [load]);

  const refresh = async () => {
    try {
      await api('/refresh?scope=github', { method: 'POST' });
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
        kicker="No 07 — GitHub"
        title="Activity from your repos"
        note="Releases, commits, and events from the repos and users you follow."
        color="var(--c-github)"
      >
        <Button variant="ghost" onClick={() => setManageOpen(true)}>
          <ListTree size={14} /> saved ({subs.github.length})
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={14} /> add repo or user
        </Button>
        <IconButton title="Refresh" onClick={refresh} spinning={loading}>
          <RefreshCw size={16} />
        </IconButton>
      </SectionHead>

      <SearchBar value={query} onChange={setQuery} placeholder="search GitHub repositories…" />

      {!searching && subs.github.length > 0 && (
        <RepoChips subs={subs.github} onAdd={() => setAddOpen(true)} onOpen={setSelectedRepo} />
      )}

      {!searching && (
        <div className={s.board}>
          <div className={s.boardHead}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={13} /> trending repos
            </span>
            <SegmentedControl
              options={[
                { value: 'daily', label: 'Today' },
                { value: 'weekly', label: 'This week' },
                { value: 'monthly', label: 'This month' },
              ]}
              value={period}
              onChange={setPeriod}
            />
          </div>
          {trending.error && <ErrorBox message={trending.error} />}
          {trending.loading && !trending.data && <Receiving label="fetching trending repos" />}
          {trending.data?.items.map((item, i) => (
            <GithubRow key={item.id} item={item} index={i} onOpen={setSelectedRepo} />
          ))}
        </div>
      )}

      {shownError && <ErrorBox message={shownError} />}
      {isLoading && <Receiving label="fetching from GitHub" />}

      {shown && (searching || subs.github.length > 0) && (
        <div className={s.board}>
          <div className={s.boardHead}>
            {searching ? `github — “${debouncedQ}”` : 'activity from your repos'}
            <span className={s.boardHeadMeta}>
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} local
            </span>
          </div>
          {shown.length === 0 && !isLoading && (
            <p style={{ padding: '16px 4px', color: 'var(--paper-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              no results.
            </p>
          )}
          {shown.map((item, i) => (
            <GithubRow key={item.id} item={item} index={i} onOpen={setSelectedRepo} />
          ))}
        </div>
      )}

      {!searching && items && hasMore && subs.github.length > 0 && (
        <div className={s.more}>
          <Button variant="ghost" onClick={() => load(page + 1, true)} disabled={loadingMore}>
            {loadingMore ? 'loading…' : 'more activity'}
          </Button>
        </div>
      )}

      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} initialPlatform="github" />
      <ManageSubsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        subs={subs.github}
        onAdd={() => setAddOpen(true)}
      />
      <RepoDetailModal item={selectedRepo} onClose={() => setSelectedRepo(null)} />
    </>
  );
}