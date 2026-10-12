// Saved — everything bookmarked in any room, kept on this machine.
//
// A shelf strip says what's kept and lets you narrow it to one room (`?p=`) or
// to titles matching a few words (`?q=`); both live in the URL so opening a post
// and coming back keeps the view. Videos sit on the Screening Room's wall; posts,
// stories and repos are index cards edged in their room's colour, each saying
// when it was kept. Newest first, as the server lists them.

import { useMemo, useState } from 'react';
import { ArrowUp, Bookmark, MessageSquare, Star } from 'lucide-react';

import { SearchBar, SectionHead } from '../components/layout/Section.jsx';
import { ReaderSheet } from '../components/wire/HNReader.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import RepoDetailModal from '../components/modals/RepoDetailModal.jsx';
import { EmptyState } from '../components/ui/index.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { compact } from '../lib/format.js';
import { ago, timeAgo } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { usePlayer, useSaved } from '../state.jsx';
import { VideoTile, Wall } from '../components/screening/tiles.jsx';
import s from './saved.module.css';

const ROOMS = [
  { id: 'youtube', label: 'Screening Room', short: 'Videos', tone: 'var(--c-youtube)' },
  { id: 'reddit', label: 'The Dispatch', short: 'Reddit', tone: 'var(--c-reddit)' },
  { id: 'hackernews', label: 'The Wire', short: 'HN', tone: 'var(--c-hn)' },
  { id: 'github', label: 'GitHub', short: 'GitHub', tone: 'var(--c-github)' },
];
const ROOM = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
const PLATFORMS = new Set(ROOMS.map((r) => r.id));

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A sentence or two of the item's own words, when the platform gave any. */
function excerptOf(item) {
  const raw = item.extra?.description || item.extra?.selftext_preview || item.description || '';
  return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Index card for saved Reddit posts / HN stories / repos (videos use VideoTile).
function SavedCard({ item, onOpen, i }) {
  const room = ROOM[item.platform] || { label: item.platform, tone: 'var(--rule-strong)' };
  const excerpt = excerptOf(item);
  const domain = item.extra?.domain;
  const repo = item.platform === 'github';
  const open = () => onOpen(item);
  return (
    <article
      className={s.card}
      style={{ '--tone': room.tone, '--i': Math.min(i, 12) }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // the bookmark inside handles its own keys
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${item.title} — ${room.label}`}
      data-kbd-tile
    >
      <SaveButton item={item} className={s.cardSave} />
      <span className={s.cardTag}>
        <i className={s.cardDot} aria-hidden="true" />
        {room.label}
        {domain && <span className={s.cardDomain}>{domain}</span>}
      </span>
      <h3 className={s.cardTitle}>{item.title}</h3>
      {excerpt && <p className={s.cardExcerpt}>{excerpt}</p>}
      <span className={s.cardMeta}>
        {[item.source, item.author, item.published_at ? ago(item.published_at) : null].filter(Boolean).join(' · ')}
      </span>
      <span className={s.cardFoot}>
        {item.score != null && (
          <span title={repo ? 'Stars' : 'Points'}>{repo ? <Star size={12} /> : <ArrowUp size={12} />}{compact(item.score)}</span>
        )}
        {item.comments_count != null && <span title="Comments"><MessageSquare size={12} />{compact(item.comments_count)}</span>}
        {item.saved_at && <span className={s.kept} title={new Date(item.saved_at * 1000).toLocaleString()}>kept {timeAgo(item.saved_at) === 'now' ? 'just now' : `${timeAgo(item.saved_at)} ago`}</span>}
      </span>
    </article>
  );
}

export default function SavedPage() {
  const { saved } = useSaved();
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [platform, setPlatform] = useParamState('p', 'all');
  const [q, setQ] = useParamState('q', '');

  const items = useMemo(
    () => Object.values(saved).sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0)),
    [saved],
  );
  const counts = useMemo(() => {
    const c = {};
    for (const it of items) c[it.platform] = (c[it.platform] || 0) + 1;
    return c;
  }, [items]);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((it) => (
    (platform === 'all' || !PLATFORMS.has(platform) || it.platform === platform)
    && (!needle || `${it.title} ${it.source || ''} ${it.author || ''}`.toLowerCase().includes(needle))
  ));
  const youtube = shown.filter((i) => i.platform === 'youtube');
  const others = shown.filter((i) => i.platform !== 'youtube');
  const oldest = items.reduce((m, it) => (it.saved_at && (!m || it.saved_at < m) ? it.saved_at : m), 0);

  const openOther = (item) => {
    if (item.platform === 'reddit') setPost(item);
    else if (item.platform === 'hackernews') setThread(item);
    else if (item.platform === 'github') setSelectedRepo(item);
    else window.open(item.url, '_blank', 'noopener');
  };

  return (
    <>
      <SectionHead
        kicker="Saved"
        title="Your reading & watch list"
        note="Everything you bookmarked, across every room — kept locally on this machine."
        color="var(--c-foryou)"
      >
        {items.length > 0 && <SearchBar value={q} onChange={setQ} placeholder="Find in saved…" />}
      </SectionHead>

      {items.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={30} />}
          color="var(--c-foryou)"
          title="Nothing saved yet"
          subtitle="Tap the bookmark on any video, post, or story to keep it here for later."
        />
      ) : (
        <nav className={s.shelf} aria-label="Filter saved by room">
          <button
            type="button"
            className={`${s.chip} ${platform === 'all' ? s.chipOn : ''}`}
            aria-pressed={platform === 'all'}
            onClick={() => setPlatform('all')}
          >
            All <b>{items.length}</b>
          </button>
          {ROOMS.filter((r) => counts[r.id]).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${s.chip} ${platform === r.id ? s.chipOn : ''}`}
              style={{ '--tone': r.tone }}
              aria-pressed={platform === r.id}
              onClick={() => setPlatform(platform === r.id ? 'all' : r.id)}
            >
              <i className={s.cardDot} aria-hidden="true" />
              {r.short} <b>{counts[r.id]}</b>
            </button>
          ))}
          {oldest > 0 && <span className={s.since}>keeping since {new Date(oldest * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
        </nav>
      )}

      {items.length > 0 && shown.length === 0 && (
        <p className={s.none}>
          Nothing saved matches{needle ? <> “{q.trim()}”</> : ' that'}.{' '}
          <button type="button" onClick={() => { setQ(''); setPlatform('all'); }}>Show everything</button>
        </p>
      )}

      {youtube.length > 0 && (
        <section className={s.group}>
          <h2 className={s.groupHead} style={{ '--tone': 'var(--c-youtube)' }}>
            Videos <span>{plural(youtube.length, 'video')}</span>
          </h2>
          <Wall>
            {youtube.map((item) => (
              <VideoTile key={item.id} item={item} onPlay={playVideo} />
            ))}
          </Wall>
        </section>
      )}

      {others.length > 0 && (
        <section className={s.group}>
          <h2 className={s.groupHead} style={{ '--tone': 'var(--c-foryou)' }}>
            Posts & stories <span>{plural(others.length, 'item')}</span>
          </h2>
          <div className={s.cards}>
            {others.map((item, i) => (
              <SavedCard key={item.id} item={item} onOpen={openOther} i={i} />
            ))}
          </div>
        </section>
      )}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      {thread && (
        <ReaderSheet
          item={thread}
          onClose={() => setThread(null)}
          onItem={(id) => setThread({ id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } })}
        />
      )}
      <RepoDetailModal item={selectedRepo} onClose={() => setSelectedRepo(null)} />
    </>
  );
}
