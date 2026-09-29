// People, drawn the same way everywhere in the Anime's social rooms.
//
//  · PersonAvatar — the face: ringed in the person's own AniList profile colour
//    (when known), a ✦ for supporters, and — when there's no picture or it fails —
//    warm initials on a tint derived from the name, never a broken image.
//  · UserLink — a name (and/or face) that opens their profile page, and on a
//    short hover shows a card: banner, badges, three numbers, a Follow button.
//  · FollowButton, PersonCard — for profiles and the people grids.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Sparkles, UserCheck, UserPlus } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { useToast } from '../../state.jsx';
import p from './person.module.css';

// AniList stores a named profile accent (or a hex); map the names to warm-ish hexes.
const PROFILE_COLORS = {
  blue: '#5fb4e6', purple: '#b06ae0', pink: '#e68fc4', orange: '#e6883a',
  red: '#d6533f', green: '#7bab54', gray: '#8a7c66', grey: '#8a7c66',
};
export function accentOf(color, fallback = 'var(--c-anime)') {
  if (!color) return fallback;
  if (color[0] === '#') return color;
  return PROFILE_COLORS[color.toLowerCase()] || fallback;
}

/** The signed-in viewer (/anime/me) as a person, drawn like everyone else. */
export function asPerson(me) {
  if (!me) return null;
  const avatar = me.avatar_url || (typeof me.avatar === 'string' ? me.avatar : me.avatar?.large) || null;
  return { id: me.id, name: me.name, avatar, color: me.color, donator: me.donator || 0 };
}

function hueOf(name) {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function initials(name) {
  const clean = (name || '?').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const parts = clean.split(/\s+|(?=[A-Z])/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

export function PersonAvatar({ user, size = 'md', className, title }) {
  const [failed, setFailed] = useState(false);
  const name = user?.name || '?';
  const src = user?.avatar;
  useEffect(() => setFailed(false), [src]);
  return (
    <span
      className={`${p.av} ${p[size]} ${user?.color ? p.ringed : ''} ${className || ''}`}
      style={{ '--ring': accentOf(user?.color, 'var(--rule-strong)'), '--hue': hueOf(name) }}
      title={title}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={p.initials} aria-hidden="true">{initials(name)}</span>
      )}
      {user?.donator > 0 && (size === 'lg' || size === 'xl') && (
        <span className={p.donor} title="AniList supporter"><Sparkles size={size === 'xl' ? 13 : 10} /></span>
      )}
    </span>
  );
}

// ── the hover card ────────────────────────────────────────────────────────────

// One fetch per person per page-life: the card is a glance, not a refresh.
const cardCache = new Map();
function loadCard(name) {
  const key = name.toLowerCase();
  if (!cardCache.has(key)) {
    cardCache.set(key, api(`/anime/user/${encodeURIComponent(name)}/card`).catch((e) => {
      cardCache.delete(key);
      throw e;
    }));
  }
  return cardCache.get(key);
}
export function forgetCard(name) {
  if (name) cardCache.delete(name.toLowerCase());
}

function Badges({ u, me }) {
  const self = me && u && me.id === u.id;
  return (
    <span className={p.badges}>
      {self && <em className={p.badgeYou}>you</em>}
      {!self && u?.is_following && u?.is_follower && <em className={p.badgeMutual}>mutual</em>}
      {!self && !u?.is_following && u?.is_follower && <em className={p.badgeFollows}>follows you</em>}
      {u?.donator > 0 && <em className={p.badgeDonor}><Sparkles size={9} /> supporter</em>}
    </span>
  );
}

function HoverCard({ name, anchor, onEnter, onLeave }) {
  const [u, setU] = useState(null);
  const [error, setError] = useState(false);
  const me = useApi('/anime/me');
  useEffect(() => {
    let alive = true;
    loadCard(name).then((d) => alive && setU(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [name]);
  const box = anchor.getBoundingClientRect();
  const W = 296;
  const left = Math.min(Math.max(8, box.left), window.innerWidth - W - 8);
  const below = box.bottom + 230 < window.innerHeight;
  const style = below
    ? { left, top: box.bottom + 8 }
    : { left, bottom: window.innerHeight - box.top + 8 };
  return createPortal(
    <div
      className={p.card}
      style={{ ...style, width: W, '--accent': accentOf(u?.color) }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="dialog"
      aria-label={`${name}'s profile card`}
    >
      <div className={p.cardBanner} style={u?.banner ? { backgroundImage: `url(${u.banner})` } : undefined} />
      <div className={p.cardBody}>
        <PersonAvatar user={u || { name }} size="lg" className={p.cardAv} />
        <div className={p.cardHead}>
          <Link to={`/anime/user/${encodeURIComponent(name)}`} className={p.cardName}>{u?.name || name}</Link>
          {u && <Badges u={u} me={me.data} />}
        </div>
        {error && <p className={p.cardNote}>Couldn't load this profile.</p>}
        {!u && !error && <p className={p.cardNote}>tuning in…</p>}
        {u && (
          <>
            <dl className={p.cardStats}>
              <div><dt>titles</dt><dd>{u.stats.count.toLocaleString()}</dd></div>
              <div><dt>days</dt><dd>{u.stats.days}</dd></div>
              <div><dt>mean</dt><dd>{u.stats.mean ? Math.round(u.stats.mean) : '—'}</dd></div>
            </dl>
            <div className={p.cardActions}>
              {me.data && me.data.id !== u.id && <FollowButton user={u} compact />}
              <Link to={`/anime/user/${encodeURIComponent(u.name)}`} className={p.cardOpen}>Open profile →</Link>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A person's name (and/or face) that opens their profile — with a hover card. */
export function UserLink({ user, size = 'xs', showName = true, showAvatar = true, className, children }) {
  const name = user?.name;
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const timers = useRef({});
  const clear = () => { clearTimeout(timers.current.in); clearTimeout(timers.current.out); };
  const enter = useCallback(() => {
    clearTimeout(timers.current.out);
    timers.current.in = setTimeout(() => setOpen(true), 450);
  }, []);
  const leave = useCallback(() => {
    clearTimeout(timers.current.in);
    timers.current.out = setTimeout(() => setOpen(false), 160);
  }, []);
  useEffect(() => clear, []);
  if (!name) return null;
  return (
    <>
      <Link
        ref={ref}
        to={`/anime/user/${encodeURIComponent(name)}`}
        className={`${p.link} ${className || ''}`}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={(e) => { e.stopPropagation(); clear(); setOpen(false); }}
      >
        {showAvatar && <PersonAvatar user={user} size={size} />}
        {showName && <span className={p.linkName}>{name}</span>}
        {children}
      </Link>
      {open && ref.current && (
        <HoverCard name={name} anchor={ref.current} onEnter={() => clearTimeout(timers.current.out)} onLeave={leave} />
      )}
    </>
  );
}

// ── follow ────────────────────────────────────────────────────────────────────

export function FollowButton({ user, compact = false, onChange }) {
  const toast = useToast();
  const [on, setOn] = useState(!!user.is_following);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(!!user.is_following), [user.is_following]);
  const flip = async (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setBusy(true);
    try {
      const res = await api('/anime/follow', { method: 'POST', body: JSON.stringify({ user_id: user.id }) });
      setOn(res.is_following);
      forgetCard(user.name);
      onChange?.(res.is_following);
      toast(res.is_following ? `Following ${user.name}` : `Unfollowed ${user.name}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <button
      type="button"
      className={`${p.follow} ${on ? p.followOn : ''} ${compact ? p.followCompact : ''}`}
      onClick={flip}
      disabled={busy}
      aria-pressed={on}
    >
      {on ? <UserCheck size={14} /> : <UserPlus size={14} />}
      {on ? 'Following' : user.is_follower ? 'Follow back' : 'Follow'}
    </button>
  );
}

// ── a person, as a card in a grid ─────────────────────────────────────────────

export function PersonCard({ user, me, index = 0 }) {
  const self = me && me.id === user.id;
  const s = user.stats;
  return (
    <article className={p.person} style={{ '--accent': accentOf(user.color), '--i': Math.min(index, 16) }}>
      <Link to={`/anime/user/${encodeURIComponent(user.name)}`} className={p.personLink} aria-label={`${user.name}'s profile`}>
        <span className={p.personBanner} style={user.banner ? { backgroundImage: `url(${user.banner})` } : undefined} />
        <PersonAvatar user={user} size="lg" className={p.personAv} />
        <span className={p.personName}>{user.name}</span>
        <Badges u={user} me={me} />
        {s && (
          <span className={p.personStats}>
            <b>{s.count.toLocaleString()}</b> titles · <b>{s.days}</b> days{s.mean ? <> · mean <b>{Math.round(s.mean)}</b></> : null}
          </span>
        )}
      </Link>
      <div className={p.personActions}>
        {me && !self && user.id && <FollowButton user={user} compact />}
        <Link to={`/anime?tab=ledger&cmp=${encodeURIComponent(user.name)}`} className={p.personCompare} title="Compare tastes">
          compare
        </Link>
      </div>
    </article>
  );
}
