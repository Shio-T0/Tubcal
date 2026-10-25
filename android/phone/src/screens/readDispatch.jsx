// The Dispatch on Read (the Reddit room's part of the phone app, in its split
// APK): your subreddits (or your Reddit home feed when connected), hot/new/top and
// a search of all of Reddit, set as letters; and one subreddit on its own page.

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, ExternalLink, Flame, Inbox, MessageSquare, Plus, Search, Share2, Sparkles, TrendingUp } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useSettings, useSubscriptions } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import { ActionSheet, AppBar, Chips, Empty, ErrorNote, IconBtn, Skeleton, useLongPress, usePullToRefresh } from '../shell/Shell.jsx';
import { BarSearch, FaceRow, SaveShareActions, useItemMenu } from './readKit.jsx';
import { RedditPage } from './redditPage.jsx';
import r from './read.module.css';
import d from './readDispatch.module.css';

function Letter({ item, onOpen, onMenu }) {
  const x = item.extra || {};
  const lp = useLongPress(() => onMenu(item));
  return (
    <article className={d.letter} data-reveal>
      <button type="button" className={d.letterHit} onClick={() => onOpen(item)} {...lp}>
        <span className={d.letterTop}>
          <b className={d.sub}>{item.source}</b>
          <span>{item.author && `u/${item.author} · `}{ago(item.published_at)}</span>
        </span>
        <span className={d.letterMain}>
          <span className={d.letterWords}>
            <strong>{item.title}</strong>
            {x.selftext_preview && <span className={r.excerpt}>{x.selftext_preview}</span>}
            {x.link_url && <span className={d.linkOut}><ArrowUpRight size={12} /> {x.link_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>}
          </span>
          {item.thumbnail && <img className={d.letterPic} src={item.thumbnail} alt="" loading="lazy" />}
        </span>
      </button>
      <div className={d.letterFoot}>
        {item.score != null && <span><TrendingUp size={14} /> {compact(item.score)}</span>}
        <button type="button" onClick={() => onOpen(item)}><MessageSquare size={14} /> {compact(item.comments_count ?? 0)}</button>
        <button type="button" className={d.letterMore} onClick={() => onMenu(item)} aria-label="More">⋯</button>
      </div>
    </article>
  );
}

const SORTS = [{ key: 'hot', label: 'Hot', Icon: Flame }, { key: 'new', label: 'New', Icon: Sparkles }, { key: 'top', label: 'Top', Icon: TrendingUp }];

/** A letter's long-press menu; given `navigate`, with a "Go to r/…" line. */
function letterActions(menu, { saved, toggleSaved, setPost, navigate }) {
  if (!menu) return [];
  return [
    { label: 'Read the post', Icon: MessageSquare, onClick: () => setPost(menu) },
    menu.extra?.link_url && { label: 'Open the link', Icon: ArrowUpRight, onClick: () => openExternal(menu.extra.link_url) },
    navigate && { label: `Go to ${menu.source}`, Icon: Inbox, onClick: () => navigate(`/reddit/r/${(menu.extra?.subreddit || menu.source || '').replace(/^r\//, '')}`) },
    ...SaveShareActions(menu, saved, toggleSaved),
    { label: 'Open on Reddit', Icon: ExternalLink, onClick: () => openExternal(menu.url) },
  ];
}

export default function Dispatch({ search, registerRefresh, onAdd }) {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const { subs } = useSubscriptions();
  const sort = settings?.reddit_sort || 'hot';
  const [source, setSource] = useParamState('src', 'curated');
  const [post, setPost] = useState(null);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  const oauth = useApi('/oauth/status');
  const connected = !!oauth.data?.reddit?.connected;
  const hasSubs = subs.reddit.length > 0;
  const enabled = source === 'account' || hasSubs;
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&source=${source}`, enabled && !searching);
  const found = useApi(`/reddit/search?q=${encodeURIComponent(dq)}`, searching);
  const active = searching ? found : feed;
  registerRefresh(async () => {
    try { await api('/refresh?scope=reddit', { method: 'POST' }); } catch { /* best-effort */ }
    return active.reload();
  });
  return (
    <>
      {search == null && (
        <>
          {hasSubs && <FaceRow subs={subs.reddit} onAdd={onAdd} onPick={(s) => navigate(`/reddit/r/${s.source_id}`)} />}
          <div className={r.filters}>
            <Chips items={SORTS} value={sort} onChange={(v) => updateSettings({ reddit_sort: v })} />
            {connected && <Chips items={[{ key: 'curated', label: 'Your subreddits' }, { key: 'account', label: 'Home feed' }]} value={source} onChange={setSource} />}
          </div>
        </>
      )}
      {!enabled && !searching && search == null && (
        <Empty
          Icon={Inbox}
          title="No letters yet"
          text="Subscribe to the forums you care about and their posts are set here."
          action={<button type="button" className={r.cta} onClick={onAdd}><Plus size={16} /> Add a subreddit</button>}
        />
      )}
      {search != null && !searching && <Empty Icon={Search} title="Search all of Reddit" text="Type two letters or more." />}
      {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
      {(enabled || searching) && active.loading && !active.data && <Skeleton kind="lines" n={5} />}
      {active.data?.items.map((it) => <Letter key={it.id} item={it} onOpen={setPost} onMenu={setMenu} />)}
      {searching && active.data && !active.data.items.length && <Empty Icon={Search} title="Nothing found" text={`Reddit returned nothing for “${dq}”.`} />}
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={letterActions(menu, { saved, toggleSaved, setPost, navigate })} />
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
    </>
  );
}

/** One subreddit, on its own page. */
export function Subreddit() {
  const { sub } = useParams();
  const { subs } = useSubscriptions();
  const row = subs.reddit.find((x) => x.source_id === sub);
  const { settings, updateSettings } = useSettings();
  const sort = settings?.reddit_sort || 'hot';
  const [search, setSearch] = useState(null);
  const [post, setPost] = useState(null);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&subs=${sub}`, !searching);
  const found = useApi(`/reddit/search?q=${encodeURIComponent(dq)}&sub=${sub}`, searching);
  const active = searching ? found : feed;
  const pull = usePullToRefresh(async () => { await active.reload(); });
  const name = row?.display_name || `r/${sub}`;

  return (
    <div className={r.screen} style={{ '--c': 'var(--c-reddit)' }}>
      <AppBar
        title={search != null ? <BarSearch value={search} onChange={setSearch} placeholder={`Search ${name}…`} onClose={() => setSearch(null)} /> : name}
        sub={search != null ? null : row ? 'your subreddit' : 'subreddit'}
        back={search == null}
        backTo="/reddit"
        tone="var(--c-reddit)"
        actions={search == null && (
          <>
            <IconBtn label="Search" onClick={() => setSearch('')}><Search size={21} /></IconBtn>
            <IconBtn label="Share" onClick={() => share({ title: name, url: `https://www.reddit.com/r/${sub}` })}><Share2 size={20} /></IconBtn>
          </>
        )}
      >
        {search == null && <Chips items={SORTS} value={sort} onChange={(v) => updateSettings({ reddit_sort: v })} />}
      </AppBar>
      {pull}
      {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
      {active.loading && !active.data && <Skeleton kind="lines" n={6} />}
      {active.data?.items.map((it) => <Letter key={it.id} item={it} onOpen={setPost} onMenu={setMenu} />)}
      {active.data && !active.data.items.length && <Empty Icon={Inbox} title="Nothing here" text={searching ? `No posts in ${name} match “${dq}”.` : 'This subreddit is quiet.'} />}
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={letterActions(menu, { saved, toggleSaved, setPost })} />
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
    </div>
  );
}
