import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Mail, MessageCircle, Plus, RefreshCw, TrendingUp } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { chipStyles as c, ErrorBox, Receiving, SearchBar, SectionHead, useDebounced } from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import { Button, EmptyState, IconButton, SegmentedControl } from '../components/ui/index.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { useSettings, useSubscriptions } from '../state.jsx';
import s from './dispatch.module.css';

const SUGGESTIONS = ['r/programming', 'r/linux', 'r/selfhosted', 'r/space'];

function Entry({ item, index, lead, onOpen }) {
  const { extra } = item;
  const thumb = item.thumbnail;
  return (
    <article
      className={`${s.entry} ${lead ? s.lead : ''}`}
      style={{ '--i': index }}
      onClick={() => onOpen(item)}
    >
      <div>
        <div className={s.tagRow}>
          <span className={s.subTag}>{item.source}</span>
          <span className={s.tagMeta}>
            {item.author} · {timeAgo(item.published_at)}
          </span>
        </div>
        <h3 className={s.headline}>{item.title}</h3>
        {!lead && thumb && <img className={s.thumb} src={thumb} alt="" loading="lazy" />}
        {extra.selftext_preview && <p className={s.excerpt}>{extra.selftext_preview}</p>}
        {extra.link_url && (
          <span className={s.linkOut}>
            <ArrowUpRight size={12} />
            {extra.link_url.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
        )}
        <div className={s.entryFoot}>
          {item.score != null && (
            <span className={s.stat}>
              <TrendingUp size={12} /> {compact(item.score)}
            </span>
          )}
          {item.comments_count != null && (
            <span className={s.stat}>
              <MessageCircle size={12} /> {compact(item.comments_count)}
            </span>
          )}
          <span className={s.stat}>read thread →</span>
          <span style={{ marginLeft: 'auto', position: 'relative' }}>
            <SaveButton item={item} />
          </span>
        </div>
      </div>
      {lead && thumb && <img className={s.leadThumb} src={thumb} alt="" loading="lazy" />}
    </article>
  );
}

function Sheet({ items, onOpen }) {
  return (
    <div className={s.sheet}>
      {items.map((item, i) => (
        <Entry key={item.id} item={item} index={i} lead={i === 0} onOpen={onOpen} />
      ))}
    </div>
  );
}

function SubChips({ subs, onAdd, activeSub }) {
  return (
    <div className={c.chips} style={{ '--chip-c': 'var(--c-reddit)' }}>
      {subs.map((sub) => (
        <Link
          key={sub.id}
          to={`/reddit/r/${sub.source_id}`}
          className={`${c.chip} ${activeSub === sub.source_id ? c.chipActive : ''}`}
        >
          {sub.thumbnail ? (
            <img className={c.chipAvatar} src={sub.thumbnail} alt="" />
          ) : (
            <span className={c.chipLetter}>{sub.source_id.charAt(0).toUpperCase()}</span>
          )}
          {sub.display_name}
        </Link>
      ))}
      <button className={`${c.chip} ${c.chipGhost}`} onClick={onAdd}>
        <Plus size={13} /> add subreddit
      </button>
    </div>
  );
}

export default function Dispatch() {
  const { settings, updateSettings } = useSettings();
  const { subs } = useSubscriptions();
  const sort = settings?.reddit_sort || 'hot';
  const [source, setSource] = useState('curated');
  const [post, setPost] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounced(query.trim());

  const hasSubs = subs.reddit.length > 0;
  const oauth = useApi('/oauth/status');
  const connected = oauth.data?.reddit?.connected;
  const enabled = source === 'account' || hasSubs;

  const searching = debouncedQ.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&source=${source}`, enabled && !searching);
  const search = useApi(`/reddit/search?q=${encodeURIComponent(debouncedQ)}`, searching);
  const active = searching ? search : feed;

  const refresh = async () => {
    try {
      await api('/refresh?scope=reddit', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    active.reload();
  };

  return (
    <>
      <SectionHead
        kicker="No 03 — The Dispatch"
        title="Letters from the forums"
        note="Your subreddits, set like a broadsheet. Open any letter to read the thread."
        color="var(--c-reddit)"
      >
        {connected && (
          <SegmentedControl
            options={[
              { value: 'curated', label: 'Curated' },
              { value: 'account', label: 'Home feed' },
            ]}
            value={source}
            onChange={setSource}
          />
        )}
        <SegmentedControl
          options={['hot', 'new', 'top']}
          value={sort}
          onChange={(v) => updateSettings({ reddit_sort: v })}
        />
        <IconButton title="Refresh" onClick={refresh} spinning={active.loading}>
          <RefreshCw size={16} />
        </IconButton>
      </SectionHead>

      {(hasSubs || connected) && (
        <SearchBar value={query} onChange={setQuery} placeholder="search all of reddit…" />
      )}
      {hasSubs && <SubChips subs={subs.reddit} onAdd={() => setAddOpen(true)} />}

      {!enabled && !searching && (
        <EmptyState
          icon={<Mail size={32} />}
          color="var(--c-reddit)"
          title="No letters yet"
          subtitle="Subscribe to the forums you care about — their dispatches will be typeset here."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add a subreddit
            </Button>
          }
          suggestions={SUGGESTIONS}
          onSuggestion={() => setAddOpen(true)}
        />
      )}

      {active.error && <ErrorBox message={active.error} />}
      {(enabled || searching) && active.loading && !active.data && (
        <Receiving label={searching ? 'wiring your query' : 'collecting the post'} />
      )}
      {active.data && <Sheet items={active.data.items} onOpen={setPost} />}
      {searching && active.data?.items.length === 0 && (
        <p style={{ color: 'var(--paper-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          the wire returned nothing for “{debouncedQ}”.
        </p>
      )}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} initialPlatform="reddit" />
    </>
  );
}

export function SubredditPage() {
  const { sub } = useParams();
  const { subs } = useSubscriptions();
  const subRow = subs.reddit.find((x) => x.source_id === sub);
  const { settings, updateSettings } = useSettings();
  const sort = settings?.reddit_sort || 'hot';
  const [post, setPost] = useState(null);
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounced(query.trim());

  const searching = debouncedQ.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&subs=${sub}`, !searching);
  const search = useApi(
    `/reddit/search?q=${encodeURIComponent(debouncedQ)}&sub=${sub}`,
    searching,
  );
  const active = searching ? search : feed;

  return (
    <>
      <Link to="/reddit" className={c.backLink}>
        <ArrowLeft size={13} /> back to the dispatch
      </Link>
      <div className={s.subHead}>
        <div>
          <span className="kicker" style={{ color: 'var(--c-reddit)' }}>
            Single-forum edition
          </span>
          <h1 className={s.subTitle}>{subRow?.display_name || `r/${sub}`}</h1>
        </div>
        <SegmentedControl
          options={['hot', 'new', 'top']}
          value={sort}
          onChange={(v) => updateSettings({ reddit_sort: v })}
        />
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder={`search r/${sub}…`} />

      {active.error && <ErrorBox message={active.error} />}
      {active.loading && !active.data && <Receiving label="collecting the post" />}
      {active.data && <Sheet items={active.data.items} onOpen={setPost} />}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
    </>
  );
}
