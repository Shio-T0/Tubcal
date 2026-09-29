// The activity stream as a timeline: posts are letters, list updates are small
// stamped slips ("watched episode 5 of …" with the poster), days are marked, and
// a conversation opens in place — replies read beneath the post they answer, with
// a reply desk (and its live preview) right there.
//
// Used for everyone, for the people you follow, for one title (detail page) and
// for one person (their profile). The slice (all / conversations / posts /
// watching) is in the URL as ?ak=.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Lock, MessageSquare, Trash2 } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { timeAgo } from '../../lib/time.js';
import { useToast } from '../../state.jsx';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { MarkdownComposer } from './Composer.jsx';
import { asPerson, UserLink } from './Person.jsx';
import { AniHtml } from './RichText.jsx';
import { InfiniteSentinel, useInfinite, useParamState } from './shared.jsx';
import { LikeButton } from './Thread.jsx';
import a from './activity.module.css';

export const ACTIVITY_KINDS = [['', 'Everything'], ['talk', 'Conversations'], ['text', 'Posts'], ['list', 'Watching']];

const fullDate = (s) => (s ? new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function dayLabel(sec) {
  const d = new Date(sec * 1000);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const opts = { weekday: 'long', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

function MediaTitle({ media }) {
  if (!media?.title) return null;
  if (media.id && media.type !== 'MANGA') return <Link to={`/anime/${media.id}`} className={a.mediaLink}>{media.title}</Link>;
  if (media.id) {
    return <a href={`https://anilist.co/manga/${media.id}`} target="_blank" rel="noreferrer" className={a.mediaLink}>{media.title}</a>;
  }
  return <b>{media.title}</b>;
}

// ── replies ───────────────────────────────────────────────────────────────────

function Replies({ activity, meId, me, onCount }) {
  const toast = useToast();
  const res = useApi(`/anime/activity/${activity.id}/replies`);
  const [added, setAdded] = useState([]);
  const [gone, setGone] = useState(() => new Set());
  const items = [...(res.data?.items || []), ...added].filter((r) => !gone.has(r.id));

  const reply = async (text) => {
    try {
      const r = await api(`/anime/activity/${activity.id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      setAdded((x) => [...x, {
        id: r?.id ?? Date.now(), text: r?.text || `<p>${text.replace(/</g, '&lt;')}</p>`,
        created_at: r?.createdAt || Math.floor(Date.now() / 1000), likes: 0, liked: false, user: me, fresh: true,
      }]);
      onCount(1);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const remove = async (rid) => {
    if (!window.confirm('Delete your reply from AniList?')) return;
    try {
      await api(`/anime/activity/${activity.id}/reply/${rid}`, { method: 'DELETE' });
      setGone((g) => new Set(g).add(rid));
      onCount(-1);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className={a.replies}>
      {res.loading && !res.data && <p className={a.muted}>fetching the conversation…</p>}
      {res.error && <p className={a.muted}>{res.error}</p>}
      {items.map((r) => (
        <div key={r.id} className={`${a.reply} ${r.fresh ? a.fresh : ''}`}>
          <UserLink user={r.user} size="sm" showName={false} />
          <div className={a.replyMain}>
            <div className={a.head}>
              <UserLink user={r.user} showAvatar={false} className={a.name} />
              {r.user?.id === activity.user?.id && <span className={a.author}>author</span>}
              <span className={a.when} title={fullDate(r.created_at)}>{timeAgo(r.created_at)}</span>
            </div>
            <AniHtml html={r.text} className={a.text} />
            <div className={a.acts}>
              <LikeButton id={r.id} type="ACTIVITY_REPLY" liked={r.liked} likes={r.likes} />
              {meId && r.user?.id === meId && (
                <button type="button" className={`${a.act} ${a.danger}`} onClick={() => remove(r.id)} title="Delete your reply">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {meId ? (
        <div className={a.replyDesk}>
          <MarkdownComposer
            compact
            previewAs="reply"
            submitLabel="Reply"
            placeholder={`Reply to ${activity.user?.name || 'this'}…`}
            draftKey={`activity:${activity.id}`}
            onSubmit={reply}
          />
        </div>
      ) : (
        <p className={a.muted}>Connect AniList to reply.</p>
      )}
    </div>
  );
}

// ── one entry ─────────────────────────────────────────────────────────────────

function Entry({ item, meId, me, onDeleted, startOpen = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [count, setCount] = useState(item.replies || 0);
  const mine = meId && item.user?.id === meId;
  const isList = item.kind === 'ListActivity';
  const remove = async () => {
    if (!window.confirm('Delete this from your AniList activity?')) return;
    try {
      await api(`/anime/activity/${item.id}`, { method: 'DELETE' });
      toast('Deleted', 'success');
      onDeleted?.(item.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <article className={`${a.entry} ${isList ? a.slip : a.letter} ${item.fresh ? a.fresh : ''}`}>
      <div className={a.gutter}>
        <UserLink user={item.user} size={isList ? 'sm' : 'md'} showName={false} />
      </div>
      <div className={a.card}>
        {!isList && (
          <header className={a.head}>
            <UserLink user={item.user} showAvatar={false} className={a.name} />
            {item.kind === 'MessageActivity' && item.recipient && (
              <span className={a.to}>
                → <UserLink user={item.recipient} size="xs" />
                {item.private && <span className={a.private}><Lock size={10} /> private</span>}
              </span>
            )}
            <a className={a.when} href={`https://anilist.co/activity/${item.id}`} target="_blank" rel="noreferrer"
               title={`${fullDate(item.created_at)} — open on AniList`}>
              {timeAgo(item.created_at)}
            </a>
          </header>
        )}
        {isList ? (
          <div className={a.update}>
            <p className={a.updateLine}>
              <UserLink user={item.user} showAvatar={false} className={a.name} />{' '}
              <span className={a.verb}>{item.status}{item.progress ? ` ${item.progress} of` : ''}</span>{' '}
              <MediaTitle media={item.media} />
              <a className={a.whenInline} href={`https://anilist.co/activity/${item.id}`} target="_blank" rel="noreferrer"
                 title={`${fullDate(item.created_at)} — open on AniList`}>
                {timeAgo(item.created_at)}
              </a>
            </p>
            {item.media?.cover && (
              item.media.type !== 'MANGA' && item.media.id
                ? <Link to={`/anime/${item.media.id}`} className={a.poster}><img src={item.media.cover} alt="" loading="lazy" /></Link>
                : <span className={a.poster}><img src={item.media.cover} alt="" loading="lazy" /></span>
            )}
          </div>
        ) : (
          <AniHtml html={item.text} className={a.text} />
        )}
        <footer className={a.acts}>
          <LikeButton id={item.id} type="ACTIVITY" liked={item.liked} likes={item.likes} />
          <button type="button" className={`${a.act} ${open ? a.actOn : ''}`} onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}>
            <MessageSquare size={13} /> {count > 0 ? `${count} ${count === 1 ? 'reply' : 'replies'}` : 'Reply'}
          </button>
          {mine && (
            <button type="button" className={`${a.act} ${a.danger}`} onClick={remove} title="Delete">
              <Trash2 size={12} />
            </button>
          )}
          <a className={`${a.act} ${a.ext}`} href={`https://anilist.co/activity/${item.id}`} target="_blank" rel="noreferrer"
             title="Open on AniList">
            <ExternalLink size={12} />
          </a>
        </footer>
        {open && <Replies activity={item} meId={meId} me={me} onCount={(d) => setCount((c) => c + d)} />}
      </div>
    </article>
  );
}

/** One activity on its own, conversation open — where an inbox notification lands. */
export function SingleActivity({ id }) {
  const res = useApi(`/anime/activity/${id}`);
  const meRes = useApi('/anime/me');
  if (res.loading && !res.data) return <Receiving label="finding that post" />;
  if (res.error || !res.data) return <ErrorBox message={res.error || 'That activity is gone.'} />;
  return (
    <div className={`${a.timeline} ${a.single}`}>
      <Entry item={res.data} meId={meRes.data?.id} me={asPerson(meRes.data)} startOpen />
    </div>
  );
}

// ── the feed ──────────────────────────────────────────────────────────────────

export function ActivityFeed({ mediaId, following = false, userId, showComposer }) {
  const toast = useToast();
  const meRes = useApi('/anime/me');
  const me = asPerson(meRes.data);
  const [kind, setKind] = useParamState('ak', '');
  const base = mediaId ? `media_id=${mediaId}` : following ? 'following=1' : userId ? `user_id=${userId}` : '';
  const signature = `${base}|${kind}`;
  const feed = useInfinite(signature, (page) => `/anime/activity?${[base, kind && `kind=${kind}`, `page=${page}`].filter(Boolean).join('&')}`);
  const composer = showComposer ?? (!mediaId && !userId);

  const post = async (text) => {
    try {
      const r = await api('/anime/activity', { method: 'POST', body: JSON.stringify({ text }) });
      feed.patch((prev) => [{
        id: r?.id ?? Date.now(), kind: 'TextActivity', text: r?.text || `<p>${text.replace(/</g, '&lt;')}</p>`,
        created_at: r?.createdAt || Math.floor(Date.now() / 1000), likes: 0, liked: false, replies: 0,
        user: me, fresh: true,
      }, ...prev]);
      toast('Posted to AniList', 'success');
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };

  const items = feed.items || [];
  let lastDay = null;
  return (
    <div className={a.feed}>
      {composer && me && (
        <div className={a.statusDesk}>
          <MarkdownComposer
            previewAs="status"
            submitLabel="Post"
            placeholder="What are you watching? How was it? ~!Spoilers!~ stay veiled."
            draftKey="status"
            rows={3}
            onSubmit={post}
          />
        </div>
      )}
      <div className={a.kinds} role="group" aria-label="Show">
        {ACTIVITY_KINDS.map(([v, l]) => (
          <button key={v || 'all'} type="button" className={kind === v ? a.kindOn : a.kind} onClick={() => setKind(v)} aria-pressed={kind === v}>
            {l}
          </button>
        ))}
      </div>
      {feed.loading && !feed.items && <Receiving label="tuning into the stream" />}
      {feed.error && <ErrorBox message={feed.error} />}
      {feed.items && !items.length && !feed.error && (
        <p className={a.muted}>
          {following ? 'Nothing from the people you follow yet — follow a few from their profiles.' : 'Nothing here yet.'}
        </p>
      )}
      <div className={a.timeline}>
        {items.map((it) => {
          const day = it.created_at ? dayLabel(it.created_at) : null;
          const mark = day && day !== lastDay;
          lastDay = day;
          return (
            <div key={it.id} className={a.slot}>
              {mark && <h4 className={a.day}><span>{day}</span></h4>}
              <Entry item={it} meId={meRes.data?.id} me={me}
                     onDeleted={(id) => feed.patch((prev) => prev.filter((x) => x.id !== id))} />
            </div>
          );
        })}
      </div>
      <InfiniteSentinel onReach={feed.loadMore} active={feed.hasMore} count={items.length} />
      {feed.loadingMore && <p className={a.muted}>older activity…</p>}
    </div>
  );
}
