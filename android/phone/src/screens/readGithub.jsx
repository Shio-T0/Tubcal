// GitHub on Read (the GitHub room's part of the phone app, in its split APK):
// trending repos, your followed repos' and people's activity, and repo search.

import { useState } from 'react';
import { ExternalLink, GitFork, ListTree, Plus, Search, Star, Trash2, TrendingUp } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { compact } from '@pc/lib/format.js';
import { timeAgo } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useSubscriptions, useToast } from '@pc/state.jsx';

import { openExternal } from '../lib/bridge.js';
import { ActionSheet, Chips, Empty, ErrorNote, Sentinel, Sheet, Skeleton, useLongPress } from '../shell/Shell.jsx';
import { FaceRow, SaveShareActions, usePaged, useItemMenu } from './readKit.jsx';
import { RepoPage } from './repoPage.jsx';
import r from './read.module.css';
import g from './readGithub.module.css';

function RepoLine({ item, onOpen, onMenu }) {
  const x = item.extra || {};
  const lp = useLongPress(() => onMenu(item));
  const inApp = x.type === 'repo' || x.type === 'release';
  const Icon = x.type === 'repo' ? Star : x.type === 'release' ? GitFork : ListTree;
  return (
    <button type="button" className={g.repo} onClick={() => (inApp ? onOpen(item) : openExternal(item.url))} {...lp} data-reveal>
      <span className={g.repoIcon}><Icon size={16} /></span>
      <span className={g.repoText}>
        <b>{item.title}</b>
        <span className={r.meta}>
          {item.source && <span className={r.domain}>{item.source}</span>}
          {item.author && <span>{item.author}</span>}
          {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
        </span>
        {x.type === 'repo' && x.description && <span className={r.excerpt}>{x.description}</span>}
        <span className={g.tags}>
          {x.language && <em>{x.language}</em>}
          {x.stars != null && <span><Star size={11} /> {compact(x.stars)}</span>}
          {x.forks != null && <span><GitFork size={11} /> {compact(x.forks)}</span>}
          {x.type === 'release' && x.tag && <em>{x.tag}</em>}
          {x.prerelease && <em className={g.pre}>pre-release</em>}
          {x.type === 'event' && x.event_type && <em>{x.event_type}</em>}
          {x.type === 'repo' && x.topics?.slice(0, 2).map((t) => <span key={t} className={g.topic}>{t}</span>)}
        </span>
      </span>
      {!inApp && <ExternalLink size={15} className={g.repoOut} />}
    </button>
  );
}

export default function Github({ search, registerRefresh, onAdd }) {
  const { subs, refreshSubs } = useSubscriptions();
  const toast = useToast();
  const [view, setView] = useParamState('gv', 'trending');
  const [period, setPeriod] = useParamState('p', 'daily');
  const [manage, setManage] = useState(false);
  const [repo, setRepo] = useState(null);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const trending = useApi(`/github/trending?period=${period}`, !searching && view === 'trending');
  const feed = usePaged('/feed/github', !searching && view === 'yours' && subs.github.length > 0);
  const found = useApi(`/github/search?q=${encodeURIComponent(dq)}`, searching);
  registerRefresh(async () => {
    try { await api('/refresh?scope=github', { method: 'POST' }); } catch { /* best-effort */ }
    return searching ? found.reload() : view === 'trending' ? trending.reload() : feed.reload();
  });
  const remove = async (row) => {
    try {
      await api(`/subscriptions/${row.id}`, { method: 'DELETE' });
      toast(`Removed ${row.display_name}`, 'success');
      refreshSubs();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const openSub = (s) => (s.source_id.includes('/') ? setRepo({ id: `gh:${s.source_id}`, platform: 'github', title: s.display_name, source: s.source_id, extra: { repo: s.source_id } }) : openExternal(`https://github.com/${s.source_id}`));
  const actions = menu ? [
    { label: 'Details', Icon: Star, onClick: () => setRepo(menu) },
    ...SaveShareActions(menu, saved, toggleSaved),
    { label: 'Open on GitHub', Icon: ExternalLink, onClick: () => openExternal(menu.url) },
  ] : [];

  const list = searching ? found : view === 'trending' ? trending : null;
  const items = list ? list.data?.items : feed.items;
  return (
    <>
      {search == null && (
        <>
          <FaceRow subs={subs.github} onAdd={onAdd} onPick={openSub} label="Follow" />
          <div className={r.filters}>
            <Chips
              items={[{ key: 'trending', label: 'Trending', Icon: TrendingUp }, { key: 'yours', label: 'Your repos', Icon: ListTree, count: subs.github.length }]}
              value={view}
              onChange={setView}
            />
            {view === 'trending' && (
              <Chips items={[{ key: 'daily', label: 'Today' }, { key: 'weekly', label: 'This week' }, { key: 'monthly', label: 'This month' }]} value={period} onChange={setPeriod} />
            )}
          </div>
        </>
      )}
      {search != null && !searching && <Empty Icon={Search} title="Search GitHub" text="Repositories by name, topic or description." />}
      {view === 'yours' && !searching && search == null && (
        subs.github.length ? (
          <button type="button" className={g.manage} onClick={() => setManage(true)}><ListTree size={15} /> Manage {subs.github.length} followed</button>
        ) : (
          <Empty Icon={ListTree} title="Nothing followed" text="Follow repos or users to see their releases and activity here." action={<button type="button" className={r.cta} onClick={onAdd}><Plus size={16} /> Follow a repo or user</button>} />
        )
      )}
      {(list ? list.error : feed.error) && <ErrorNote message={list ? list.error : feed.error} />}
      {(list ? list.loading && !list.data : feed.loading && !feed.items && subs.github.length > 0) && <Skeleton kind="lines" n={6} />}
      {items?.map((it) => <RepoLine key={it.id} item={it} onOpen={setRepo} onMenu={setMenu} />)}
      {items && !items.length && searching && <Empty Icon={Search} title="No results" />}
      {!list && <Sentinel onReach={feed.next} active={!!feed.items && feed.hasMore && !feed.more} />}
      <Sheet open={manage} onClose={() => setManage(false)} title="Followed on GitHub">
        <div className={g.manageList}>
          {subs.github.map((row) => (
            <div key={row.id}>
              <Avatar src={row.thumbnail} name={row.display_name} imgClass={`${r.faceImg} ${g.manageFace}`} letterClass={`${r.faceLetter} ${g.manageFace}`} />
              <span>{row.display_name}</span>
              <button type="button" onClick={() => remove(row)} aria-label={`Unfollow ${row.display_name}`}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
      </Sheet>
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={actions} />
      {repo && <RepoPage item={repo} onClose={() => setRepo(null)} />}
    </>
  );
}
