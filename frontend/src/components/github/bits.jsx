// The GitHub room's small marks: language dots and bars, release tags cut like
// luggage tags, short hashes, +/− diffstat blocks, issue and PR state, labels in
// their own colours, faces, and the buttons that star and follow.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft,
  Minus, Plus, Star,
} from 'lucide-react';

import { api } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { useSubscriptions, useToast } from '../../state.jsx';
import { commitPath, inkOn, langColor, useGhAccount } from '../../lib/gh.js';
import g from './gh.module.css';

export function LangDot({ lang, color, label = true }) {
  if (!lang) return null;
  return (
    <span className={g.lang}>
      <i style={{ '--lc': color || langColor(lang) }} aria-hidden="true" />
      {label && lang}
    </span>
  );
}

/** A repo's languages as one segmented bar, with the biggest few named under it. */
export function LangBar({ languages, max = 5 }) {
  if (!languages?.length) return null;
  const shown = languages.filter((l) => l.share >= 0.005);
  const named = shown.slice(0, max);
  const rest = 1 - named.reduce((a, l) => a + l.share, 0);
  return (
    <div className={g.langBar}>
      <div className={g.langTrack} role="img" aria-label={named.map((l) => `${l.name} ${(l.share * 100).toFixed(1)}%`).join(', ')}>
        {shown.map((l) => (
          <span key={l.name} style={{ flexGrow: l.share, '--lc': langColor(l.name) }} title={`${l.name} ${(l.share * 100).toFixed(1)}%`} />
        ))}
      </div>
      <div className={g.langKey}>
        {named.map((l) => (
          <span key={l.name}><LangDot lang={l.name} /> <em>{(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%</em></span>
        ))}
        {rest > 0.01 && <span className={g.langRest}>other {(rest * 100).toFixed(0)}%</span>}
      </div>
    </div>
  );
}

/** A release's tag, cut like a luggage tag with a punched hole. */
export function TagLabel({ tag, pre = false, big = false, title }) {
  return (
    <span className={`${g.tag} ${pre ? g.tagPre : ''} ${big ? g.tagBig : ''}`} title={title || (pre ? 'Pre-release' : 'Release')}>
      <span>{tag}</span>
    </span>
  );
}

/** A short commit hash, linking to the commit. */
export function Hash({ repo, sha, short }) {
  if (!sha) return null;
  const text = short || sha.slice(0, 7);
  return repo ? (
    <Link className={g.hash} to={commitPath(repo, sha)} title={sha}>{text}</Link>
  ) : <code className={g.hash} title={sha}>{text}</code>;
}

/** "+117 −101" and five blocks split between them, the way GitHub shows a change's size. */
export function DiffStat({ add = 0, del = 0, blocks = 5, words = true }) {
  const total = add + del;
  const greens = total ? Math.round((add / total) * blocks) : 0;
  const reds = total ? Math.min(blocks - greens, Math.max(del > 0 ? 1 : 0, Math.round((del / total) * blocks))) : 0;
  return (
    <span className={g.diffstat} title={`${add} added, ${del} removed`}>
      {words && <><b className={g.add}>+{compact(add)}</b><b className={g.del}>−{compact(del)}</b></>}
      <span className={g.blocks} aria-hidden="true">
        {Array.from({ length: blocks }, (_, i) => (
          <i key={i} className={i < greens ? g.bAdd : i < greens + reds ? g.bDel : g.bNone} />
        ))}
      </span>
    </span>
  );
}

const STATE_WORD = {
  open: 'Open', closed: 'Closed', merged: 'Merged', draft: 'Draft', not_planned: 'Not planned',
};

/** An issue's or pull request's state as GitHub draws it, in the room's colours. */
export function StateIcon({ kind, state, reason, draft, size = 15 }) {
  let Icon = CircleDot;
  let tone = 'open';
  if (kind === 'pull') {
    if (state === 'merged') { Icon = GitMerge; tone = 'merged'; }
    else if (state === 'closed') { Icon = GitPullRequestClosed; tone = 'closed'; }
    else if (draft) { Icon = GitPullRequestDraft; tone = 'draft'; }
    else Icon = GitPullRequest;
  } else if (state === 'closed') {
    if (reason === 'not_planned') { Icon = CircleSlash; tone = 'draft'; }
    else { Icon = CircleCheck; tone = 'merged'; }
  }
  return <Icon size={size} className={g[`st_${tone}`]} aria-label={STATE_WORD[draft && state === 'open' ? 'draft' : state] || state} />;
}

export function StatePill({ kind, state, reason, draft }) {
  const word = draft && state === 'open' ? 'Draft' : reason === 'not_planned' && state === 'closed' ? 'Not planned' : STATE_WORD[state] || state;
  const tone = state === 'merged' || (kind !== 'pull' && state === 'closed' && reason !== 'not_planned') ? 'merged'
    : state === 'closed' ? (kind === 'pull' ? 'closed' : 'draft') : draft ? 'draft' : 'open';
  return (
    <span className={`${g.pill} ${g[`pill_${tone}`]}`}>
      <StateIcon kind={kind} state={state} reason={reason} draft={draft} size={14} />
      {word}
    </span>
  );
}

/** A GitHub label in its own colour, softened to sit on every skin. */
export function Label({ name, color }) {
  const hex = color ? `#${color}` : null;
  return (
    <span className={g.label} style={hex ? { '--lb': hex, '--lb-ink': inkOn(hex) } : undefined}>{name}</span>
  );
}

export function Face({ src, login, size = 20, square = false }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <span className={`${g.face} ${g.faceLetter}`} style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden="true">{(login || '?')[0].toUpperCase()}</span>;
  }
  const sized = src.includes('avatars.githubusercontent.com') && !/[?&]s=/.test(src) ? `${src}${src.includes('?') ? '&' : '?'}s=${size * 2}` : src;
  return (
    <img className={`${g.face} ${square ? g.faceSquare : ''}`} src={sized} alt="" width={size} height={size} loading="lazy"
      onError={() => setBroken(true)} />
  );
}

/** Star or unstar on GitHub (needs a linked account with the scope). */
export function StarButton({ full, starred, count, onChange, compactCount = true }) {
  const { linked, can } = useGhAccount();
  const toast = useToast();
  const [on, setOn] = useState(starred);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(starred), [starred]);
  const n = count == null ? null : count + (on && !starred ? 1 : !on && starred ? -1 : 0);
  const able = linked && can.star;
  const click = async () => {
    if (!able || busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api(`/github/repo/${full}/star`, { method: next ? 'PUT' : 'DELETE' });
      onChange?.(next);
      toast(next ? `Starred ${full}` : `Unstarred ${full}`, 'success');
    } catch (e) {
      setOn(!next);
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`${g.starBtn} ${on ? g.starOn : ''}`}
      onClick={click}
      disabled={!able}
      aria-pressed={able ? !!on : undefined}
      title={able ? (on ? 'Unstar on GitHub' : 'Star on GitHub') : linked ? 'The linked token can’t star repositories' : 'Link a GitHub account to star'}
    >
      <Star size={14} fill={on ? 'currentColor' : 'none'} />
      <span>{on ? 'Starred' : 'Star'}</span>
      {n != null && <em>{compactCount ? compact(n) : n.toLocaleString()}</em>}
    </button>
  );
}

/** Follow a repo or a person here, in Tubcal (their activity joins the graph). */
export function FollowHere({ sourceId, onChange, small = false }) {
  const { subs, refreshSubs } = useSubscriptions();
  const toast = useToast();
  const row = subs.github.find((s) => s.source_id.toLowerCase() === sourceId.toLowerCase());
  const on = !!row;
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      if (row) {
        await api(`/subscriptions/${row.id}`, { method: 'DELETE' });
        toast(`Stopped following ${sourceId}`, 'success');
      } else {
        await api('/subscriptions', { method: 'POST', body: JSON.stringify({ platform: 'github', input: sourceId }) });
        toast(`Following ${sourceId} here`, 'success');
      }
      await refreshSubs();
      onChange?.(!row);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`${g.followBtn} ${on ? g.followOn : ''} ${small ? g.followSmall : ''}`} onClick={click} disabled={busy}
      title={on ? 'Stop following here' : 'Follow here: its activity joins your graph'}>
      {on ? <Minus size={13} /> : <Plus size={13} />}
      {on ? 'Following' : 'Follow'}
    </button>
  );
}

/** "Nothing here" with what to do about it. */
export function Empty({ children, action }) {
  return (
    <div className={g.empty}>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Failed({ message, onRetry }) {
  return (
    <div className={g.failed} role="alert">
      <p>{message}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label = 'Loading from GitHub' }) {
  return <div className={g.loading}><span className={g.loadingLine} />{label}</div>;
}

export function More({ onClick, busy, children = 'Load more' }) {
  return (
    <div className={g.more}>
      <button type="button" onClick={onClick} disabled={busy}>{busy ? 'Loading…' : children}</button>
    </div>
  );
}
