// The inbox: AniList notifications, and the bell that counts them.
//
// AniList keeps no per-notification read state — only an unread count that
// opening the inbox resets. So the inbox reads the count first, then loads the
// first page with the reset flag: the newest `count` rows are the new ones, and
// they stay marked for as long as you're looking.
//
// Every row goes somewhere in-app: a person to their profile, a reply to the
// conversation it's in (the post, or the thread), an airing episode to its title.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign, Bell, Database, Heart, MessageSquare, MessagesSquare, Tv, UserPlus,
} from 'lucide-react';

import { api } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { timeAgo } from '../../lib/time.js';
import { PersonAvatar, UserLink } from './Person.jsx';
import { useParamState } from './shared.jsx';
import ib from './inbox.module.css';

const GROUPS = [
  ['all', 'Everything', Bell],
  ['activity', 'Activity', MessageSquare],
  ['forum', 'Forum', MessagesSquare],
  ['follows', 'Follows', UserPlus],
  ['airing', 'Airing', Tv],
  ['media', 'Title updates', Database],
];
const ICON = {
  airing: Tv, activity: MessageSquare, forum: MessagesSquare, follows: UserPlus, media: Database, other: Bell,
};
const LIKE_TYPES = new Set(['ACTIVITY_LIKE', 'ACTIVITY_REPLY_LIKE', 'THREAD_LIKE', 'THREAD_COMMENT_LIKE']);
const MENTION_TYPES = new Set(['ACTIVITY_MENTION', 'THREAD_COMMENT_MENTION']);

/** The bell in the room's header: unread count, polled gently. */
export function InboxBell() {
  const navigate = useNavigate();
  const [n, setN] = useState(null);
  useEffect(() => {
    let alive = true;
    const poll = () => api('/anime/notifications/count')
      .then((d) => alive && setN(d.unread))
      .catch(() => alive && setN(null));
    poll();
    // Every three minutes — AniList's budget is 30 requests a minute right now, and
    // a badge that's a little late costs nothing.
    const t = setInterval(poll, 180_000);
    const onRead = () => setN(0);
    window.addEventListener('anime-inbox-read', onRead);
    return () => { alive = false; clearInterval(t); window.removeEventListener('anime-inbox-read', onRead); };
  }, []);
  if (n == null) return null;
  return (
    <button
      type="button"
      className={ib.bell}
      onClick={() => navigate('/anime?tab=discuss&d=inbox')}
      title={n ? `${n} unread AniList notification${n === 1 ? '' : 's'}` : 'AniList notifications'}
      aria-label={n ? `${n} unread notifications` : 'Notifications'}
    >
      <Bell size={16} />
      {n > 0 && <span className={ib.count}>{n > 99 ? '99+' : n}</span>}
    </button>
  );
}

/** Where a notification leads when you open it. */
function targetOf(n) {
  if (n.thread?.id) return `/anime/thread/${n.thread.id}`;
  if (n.activity_id) return `/anime/activity/${n.activity_id}`;
  if (n.type === 'FOLLOWING' && n.user?.name) return `/anime/user/${encodeURIComponent(n.user.name)}`;
  if (n.media?.id && n.media.type !== 'MANGA') return `/anime/${n.media.id}`;
  return null;
}

function dayOf(sec) {
  const d = new Date(sec * 1000);
  const now = new Date();
  const yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now - d < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function Row({ n, fresh }) {
  const navigate = useNavigate();
  const Icon = LIKE_TYPES.has(n.type) ? Heart : MENTION_TYPES.has(n.type) ? AtSign : (ICON[n.group] || Bell);
  const tone = LIKE_TYPES.has(n.type) ? ib.toneLike : MENTION_TYPES.has(n.type) ? ib.toneMention : ib[`tone_${n.group}`] || '';
  const media = n.media;
  const to = targetOf(n);

  let body;
  if (n.text) {
    body = <span>{n.text}</span>;
  } else if (n.user) {
    body = (
      <span>
        <UserLink user={n.user} showAvatar={false} className={ib.actor} />
        {n.context}
        {n.thread && <b className={ib.thread}>{n.thread.title}</b>}
      </span>
    );
  } else if (media) {
    body = <span><b>{media.title}</b>{n.context}{n.reason ? ` — ${n.reason}` : ''}</span>;
  } else {
    body = <span>{n.context}</span>;
  }

  const lead = n.user
    ? <PersonAvatar user={n.user} size="md" />
    : media?.cover
      ? <img className={ib.cover} src={media.cover} alt="" loading="lazy" />
      : <span className={ib.glyph}><Icon size={16} /></span>;

  return (
    <div
      className={`${ib.row} ${fresh ? ib.fresh : ''} ${to ? ib.go : ''}`}
      role={to ? 'link' : undefined}
      tabIndex={to ? 0 : undefined}
      onClick={(e) => { if (to && !e.target.closest('a')) navigate(to); }}
      onKeyDown={(e) => { if (to && e.key === 'Enter' && !e.target.closest('a')) navigate(to); }}
    >
      <span className={ib.lead}>
        {lead}
        {(n.user || media?.cover) && <span className={`${ib.kind} ${tone}`}><Icon size={10} /></span>}
      </span>
      <span className={ib.text}>
        {body}
        <span className={ib.when}>{timeAgo(n.created_at)} ago</span>
      </span>
      {media?.cover && n.user && <img className={ib.coverSmall} src={media.cover} alt="" loading="lazy" />}
      {fresh && <span className={ib.new}>new</span>}
    </div>
  );
}

export function Inbox() {
  const [group, setGroup] = useParamState('ng', 'all');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(0);
  const firstRun = useRef(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Only the unfiltered first load clears the count — a filtered view
        // shows a slice, and "read" should mean you saw the whole inbox.
        const reset = group === 'all';
        let unread = 0;
        if (reset && firstRun.current) {
          unread = (await api('/anime/notifications/count')).unread || 0;
        }
        const d = await api(`/anime/notifications?page=1${group !== 'all' ? `&group=${group}` : ''}${reset ? '&reset=1' : ''}`);
        if (!alive) return;
        if (reset && firstRun.current) {
          setFresh(unread);
          firstRun.current = false;
          window.dispatchEvent(new Event('anime-inbox-read'));
        }
        setItems(d.items);
        setHasNext(d.has_next);
        setPage(1);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [group]);

  const more = async () => {
    setLoading(true);
    try {
      const d = await api(`/anime/notifications?page=${page + 1}${group !== 'all' ? `&group=${group}` : ''}`);
      setItems((prev) => [...prev, ...d.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setHasNext(d.has_next);
      setPage((p) => p + 1);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  let lastDay = null;
  return (
    <div className={ib.inbox}>
      <div className={ib.filters}>
        {GROUPS.map(([k, label, Icon]) => (
          <button key={k} type="button" className={group === k ? ib.filterOn : ib.filter} onClick={() => setGroup(k)} aria-pressed={group === k}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {loading && !items.length && <Receiving label="opening the post" />}
      {!loading && !error && !items.length && <p className={ib.empty}>Nothing here — the post's been quiet.</p>}
      <div className={ib.list}>
        {items.map((n, i) => {
          const day = n.created_at ? dayOf(n.created_at) : null;
          const mark = day && day !== lastDay;
          lastDay = day;
          return (
            <div key={n.id} className={ib.slot}>
              {mark && <h4 className={ib.day}>{day}</h4>}
              <Row n={n} fresh={group === 'all' && i < fresh} />
            </div>
          );
        })}
      </div>
      {hasNext && (
        <button type="button" className={ib.moreBtn} onClick={more} disabled={loading}>
          {loading ? 'loading…' : 'older notifications'}
        </button>
      )}
    </div>
  );
}
