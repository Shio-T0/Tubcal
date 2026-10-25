// The Wire on Read (the Hacker News room's part of the phone app, in its split
// APK): HN's six lists and its whole archive search as teletype lines. Tap a story
// for the article, the comment pill for the discussion, long-press for the rest.

import { useEffect, useState } from 'react';
import {
  Briefcase, Clock, ExternalLink, Flame, HelpCircle, Inbox, MessageSquare, Rocket, Search, Sparkles, Star, TrendingUp,
} from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { useWireSeen } from '@pc/components/wire/seen.js';
import { compact, splitKind } from '@pc/lib/format.js';
import { timeAgo } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useSettings } from '@pc/state.jsx';

import { openExternal } from '../lib/bridge.js';
import { ActionSheet, Chips, Empty, ErrorNote, Loading, Sentinel, Skeleton, useLongPress } from '../shell/Shell.jsx';
import { HNPage } from './hnPage.jsx';
import { SaveShareActions, usePaged, useItemMenu } from './readKit.jsx';
import r from './read.module.css';
import w from './readWire.module.css';

const LISTS = [
  { key: 'top', label: 'Top', Icon: TrendingUp },
  { key: 'best', label: 'Best', Icon: Star },
  { key: 'new', label: 'New', Icon: Sparkles },
  { key: 'ask', label: 'Ask', Icon: HelpCircle },
  { key: 'show', label: 'Show', Icon: Rocket },
  { key: 'job', label: 'Jobs', Icon: Briefcase },
];
const RANGES = [['all', 'Any time'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

function heatOf(item) {
  if (!item.score || !item.published_at) return 0;
  const hours = Math.max(1, (Date.now() / 1000 - item.published_at) / 3600);
  return Math.min(1, item.score / hours / 60);
}

const linkOut = (it) => it.url && !it.url.includes('news.ycombinator.com/item');

function WireLine({ item, rank, seen, fresh, onDiscuss, onMenu }) {
  const { kind, rest } = splitKind(item.title);
  const heat = heatOf(item);
  const lp = useLongPress(() => onMenu(item));
  const tap = () => (linkOut(item) ? openExternal(item.url) : onDiscuss(item));
  return (
    <div className={`${w.wire} ${seen ? w.isRead : ''}`} data-reveal>
      <button type="button" className={w.wireHit} onClick={tap} {...lp}>
        <span className={w.rank}>{rank}</span>
        <span className={w.wireText}>
          <b>{kind && <em className={w.kind}>{kind}</em>}{rest}</b>
          <span className={r.meta}>
            {item.extra?.domain && <span className={r.domain}>{item.extra.domain}</span>}
            <span className={w.points}>{heat > 0.6 && <Flame size={11} />}▲ {compact(item.score) ?? 0}</span>
            {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
          </span>
          <span className={w.gauge} aria-hidden="true"><i style={{ width: `${Math.max(4, heat * 100)}%` }} /></span>
        </span>
      </button>
      <button type="button" className={w.cmts} onClick={() => onDiscuss(item)} aria-label={`${item.comments_count ?? 0} comments`}>
        <MessageSquare size={16} />
        <span>{compact(item.comments_count) ?? 0}</span>
        {fresh > 0 && <em key={fresh}>+{compact(fresh)}</em>}
      </button>
    </div>
  );
}

export default function Wire({ search, registerRefresh }) {
  const { settings, updateSettings } = useSettings();
  const [list, setList] = useParamState('l', settings?.hn_list || 'top');
  const [q, setQ] = useParamState('q', '');
  const [by, setBy] = useParamState('by', 'relevance');
  const [range, setRange] = useParamState('t', 'all');
  const [hn, setHn] = useState(null);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  const dq = useDebounced((search ?? '').trim(), 400);
  useEffect(() => { if (search != null && dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (search == null && q) setQ(''); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const searching = search != null && q.length >= 2;
  const { seen, newSince } = useWireSeen();
  const feed = usePaged(`/feed/hackernews?list=${list}`, !searching);
  const found = useApi(
    `/hackernews/search?q=${encodeURIComponent(q)}${by === 'date' ? '&sort=date' : ''}${range !== 'all' ? `&range=${range}` : ''}`,
    searching,
  );
  registerRefresh(async () => {
    try { await api('/refresh?scope=hackernews', { method: 'POST' }); } catch { /* best-effort */ }
    return searching ? found.reload() : feed.reload();
  });
  const shown = searching ? found.data?.items : feed.items;
  const loading = searching ? found.loading && !found.data : feed.loading && !feed.items;
  const error = searching ? found.error : feed.error;
  const actions = menu ? [
    linkOut(menu) && { label: 'Read the article', Icon: ExternalLink, hint: menu.extra?.domain, onClick: () => openExternal(menu.url) },
    { label: 'Discussion', Icon: MessageSquare, onClick: () => setHn(menu) },
    ...SaveShareActions(menu, saved, toggleSaved),
    { label: 'Open on Hacker News', Icon: ExternalLink, onClick: () => openExternal(`https://news.ycombinator.com/item?id=${menu.extra?.hn_id}`) },
  ] : [];

  return (
    <>
      {search == null ? (
        <Chips items={LISTS} value={list} onChange={(k) => { setList(k); updateSettings({ hn_list: k }); }} className={r.chips} />
      ) : (
        <div className={r.filters}>
          <Chips items={[{ key: 'relevance', label: 'Best match' }, { key: 'date', label: 'Newest', Icon: Clock }]} value={by} onChange={setBy} />
          <Chips items={RANGES.map(([key, label]) => ({ key, label }))} value={range} onChange={setRange} />
        </div>
      )}
      {error && <ErrorNote message={error} onRetry={searching ? found.reload : feed.reload} />}
      {loading && <Skeleton kind="lines" n={7} />}
      {search != null && !searching && <Empty Icon={Search} title="Search every story on HN" text="Type two letters or more. Order by best match or newest, and narrow it to a time window." />}
      {shown && !shown.length && !loading && <Empty Icon={Inbox} title="Nothing on the wire" text={searching ? 'No story matches that.' : 'The wire is quiet.'} />}
      {shown?.map((it, i) => (
        <WireLine key={it.id} item={it} rank={i + 1} seen={!!seen[it.extra?.hn_id]} fresh={newSince(it)} onDiscuss={setHn} onMenu={setMenu} />
      ))}
      {!searching && <Sentinel onReach={feed.next} active={!!feed.items && feed.hasMore && !feed.more} />}
      {feed.more && <Loading label="feeding paper" />}
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={actions} />
      {hn && <HNPage item={hn} onClose={() => setHn(null)} />}
    </>
  );
}
