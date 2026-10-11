// Social — the Anime's front desk for people.
//
// One slim bar across the top keeps the practical things in reach from every
// corner of it: who you are (and your counts), the faces of the people you
// follow (one click to any of them), your unread post, and the two ways to say
// something — a status or a new thread. Below it sits whichever room the index
// names: the forum, the stream (everyone's, or your people's), the inbox, or
// the people themselves.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Clapperboard, PenLine, Search, Users } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { EmptyState, Button } from '../ui/index.jsx';
import { ErrorBox, Receiving, useDebounced } from '../layout/Section.jsx';
import { ActivityFeed } from './Activity.jsx';
import { Forum } from './Forum.jsx';
import { Inbox } from './Inbox.jsx';
import { asPerson, PersonCard, UserLink } from './Person.jsx';
import { InfiniteSentinel, useInfinite, useParamState } from './shared.jsx';
import s from './social.module.css';

export const SOCIAL_MODES = ['forum', 'activity', 'following', 'inbox', 'people'];

function DeskBar({ me, profile, following, unread }) {
  const navigate = useNavigate();
  const faces = (following || []).slice(0, 14);
  const more = (profile?.following_count || following?.length || 0) - faces.length;
  return (
    <div className={s.bar}>
      <div className={s.you}>
        <UserLink user={me} size="md" showName={false} />
        <div className={s.youText}>
          <UserLink user={me} showAvatar={false} className={s.youName} />
          <span className={s.youCounts}>
            <Link to="/anime?tab=discuss&d=people&pw=following"><b>{profile?.following_count ?? '—'}</b> following</Link>
            <Link to="/anime?tab=discuss&d=people&pw=followers"><b>{profile?.followers_count ?? '—'}</b> followers</Link>
          </span>
        </div>
      </div>

      {faces.length > 0 && (
        <div className={s.faces} aria-label="People you follow">
          {faces.map((u) => <UserLink key={u.id} user={u} size="sm" showName={false} className={s.face} />)}
          {more > 0 && (
            <Link to="/anime?tab=discuss&d=people" className={s.moreFaces} title="Everyone you follow">+{more}</Link>
          )}
        </div>
      )}

      <div className={s.deskActs}>
        <button type="button" className={s.deskBtn} onClick={() => navigate('/anime?tab=discuss&d=inbox')}
                title="Your AniList notifications">
          <Bell size={14} /> Inbox{unread > 0 && <em className={s.unread}>{unread > 99 ? '99+' : unread}</em>}
        </button>
        <button type="button" className={s.deskBtn} onClick={() => navigate('/anime?tab=discuss&d=activity')}
                title="Post a status to your AniList activity">
          <PenLine size={14} /> Post
        </button>
        <button type="button" className={`${s.deskBtn} ${s.deskPrimary}`}
                onClick={() => navigate('/anime?tab=discuss&d=forum&new=1')}>
          <PenLine size={14} /> New thread
        </button>
      </div>
    </div>
  );
}

/** The side column beside a stream: the people you follow, as a quick roster. */
function Roster({ following, loading }) {
  return (
    <aside className={s.roster}>
      <h3 className={s.sideHead}><Users size={13} /> Your people</h3>
      {loading && !following && <p className={s.muted}>counting heads…</p>}
      {following && !following.length && (
        <p className={s.muted}>You're not following anyone yet. <Link to="/anime?tab=discuss&d=people&pw=find">Find people →</Link></p>
      )}
      <ul className={s.rosterList}>
        {(following || []).slice(0, 24).map((u) => (
          <li key={u.id}>
            <UserLink user={u} size="sm" className={s.rosterName} />
            {u.is_follower && <span className={s.mutual} title="Follows you back">mutual</span>}
            {u.stats && <span className={s.rosterStat}>{u.stats.count}</span>}
          </li>
        ))}
      </ul>
      {following && following.length > 24 && (
        <Link to="/anime?tab=discuss&d=people" className={s.sideMore}>everyone you follow →</Link>
      )}
    </aside>
  );
}

// ── people ────────────────────────────────────────────────────────────────────

const PEOPLE_VIEWS = [['following', 'Following'], ['followers', 'Followers'], ['find', 'Find people']];

/** Who someone follows, or who follows them, as a wall of person cards. */
export function FollowGrid({ userId, which, me }) {
  const list = useInfinite(`${userId}:${which}`, (page) => `/anime/follows/${userId}?which=${which}&page=${page}`);
  const mine = me && me.id === userId;
  return (
    <>
      {list.loading && !list.items && <Receiving label="counting heads" />}
      {list.error && <ErrorBox message={list.error} />}
      {list.items && !list.items.length && (
        <p className={s.muted}>
          {which === 'following'
            ? (mine ? "You're not following anyone yet — try Find people." : 'Not following anyone yet.')
            : 'No followers yet.'}
        </p>
      )}
      <div className={s.grid}>
        {(list.items || []).map((u, i) => <PersonCard key={u.id} user={u} me={me} index={i} />)}
      </div>
      <InfiniteSentinel onReach={list.loadMore} active={list.hasMore} count={list.items?.length || 0} />
    </>
  );
}

function FindPeople({ me }) {
  const [q, setQ] = useParamState('pq', '');
  const [text, setText] = useState(q);
  const dq = useDebounced(text);
  useEffect(() => { if (dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useInfinite(`find:${dq}`, (page) => `/anime/people?kind=users&q=${encodeURIComponent(dq)}&page=${page}`,
    { enabled: dq.trim().length > 1 });
  return (
    <>
      <label className={s.find}>
        <Search size={15} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find someone on AniList by name…" autoFocus />
      </label>
      {dq.trim().length <= 1 && <p className={s.muted}>Type a name — anyone on AniList.</p>}
      {dq.trim().length > 1 && list.loading && !list.items && <Receiving label="looking them up" />}
      {list.error && <ErrorBox message={list.error} />}
      {dq.trim().length > 1 && list.items && !list.items.length && <p className={s.muted}>Nobody by that name.</p>}
      <div className={s.grid}>
        {(dq.trim().length > 1 ? list.items || [] : []).map((u, i) => <PersonCard key={u.id} user={u} me={me} index={i} />)}
      </div>
      <InfiniteSentinel onReach={list.loadMore} active={list.hasMore} count={list.items?.length || 0} />
    </>
  );
}

function PeopleView({ me }) {
  const [view, setView] = useParamState('pw', 'following');
  const v = PEOPLE_VIEWS.some(([k]) => k === view) ? view : 'following';
  return (
    <div className={s.people}>
      <div className={s.tabs} role="tablist">
        {PEOPLE_VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={v === k} className={v === k ? s.tabOn : s.tab} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      {v === 'find' ? <FindPeople me={me} /> : <FollowGrid userId={me.id} which={v} me={me} />}
    </div>
  );
}

// ── the desk ──────────────────────────────────────────────────────────────────

export function SocialDesk({ mode }) {
  const meRes = useApi('/anime/me');
  const me = asPerson(meRes.data);
  const count = useApi('/anime/notifications/count', !!me);
  const [read, setRead] = useState(false);
  useEffect(() => {
    const onRead = () => setRead(true);
    window.addEventListener('anime-inbox-read', onRead);
    return () => window.removeEventListener('anime-inbox-read', onRead);
  }, []);
  const unread = read ? 0 : count.data?.unread || 0;
  const profile = useApi(me ? `/anime/user/${encodeURIComponent(me.name)}` : null, !!me);
  const follows = useApi(me ? `/anime/follows/${me.id}?which=following` : null, !!me);
  const following = follows.data?.items;
  const needs = !me && ['following', 'inbox', 'people'].includes(mode);

  return (
    <div className={s.desk}>
      {me && <DeskBar me={{ ...me, color: profile.data?.color || me.color }} profile={profile.data} following={following} unread={unread} />}
      {needs && !meRes.loading && (
        <EmptyState
          icon={<Clapperboard size={32} />}
          color="var(--c-anime)"
          title="Connect AniList for this"
          subtitle="Your inbox, the people you follow and their activity all come from your AniList account."
          action={<Button onClick={() => (window.location.href = '/settings?s=accounts')}>Open Settings</Button>}
        />
      )}
      {mode === 'forum' && <Forum />}
      {(mode === 'activity' || (mode === 'following' && me)) && (
        <div className={s.stream}>
          <ActivityFeed following={mode === 'following'} />
          {me && <Roster following={following} loading={follows.loading} />}
        </div>
      )}
      {mode === 'inbox' && me && <Inbox />}
      {mode === 'people' && me && <PeopleView me={me} />}
    </div>
  );
}
