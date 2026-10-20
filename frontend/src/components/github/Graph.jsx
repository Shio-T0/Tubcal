// The activity graph: what the repos and people you follow did, drawn the way
// `git log --graph` would. Each day is the trunk; each repo that did something
// that day branches off it in its language's colour, carries its commits,
// releases, issues and pull requests as nodes, and merges back.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';

import { compact } from '../../lib/format.js';
import { SaveButton } from '../ui/ItemActions.jsx';
import { Face, Hash, Label, StateIcon, TagLabel } from './bits.jsx';
import { itemPath, laneColor, repoPath, userPath } from '../../lib/gh.js';
import g from './gh.module.css';

const DAY = 86400000;
const SHOW = 5; // nodes per branch before the rest fold away (releases always show)

function dayStart(epoch) {
  const d = new Date(epoch * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(start) {
  const today = dayStart(Date.now() / 1000);
  if (start === today) return 'Today';
  if (start === today - DAY) return 'Yesterday';
  const d = new Date(start);
  const opts = today - start < 6 * DAY ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' };
  return d.toLocaleDateString(undefined, opts);
}

function hhmm(epoch) {
  return new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const kindOfItem = (it) => it.extra?.type || 'event';

function tally(items) {
  const c = { commit: 0, release: 0, pull: 0, issue: 0, event: 0 };
  for (const it of items) c[kindOfItem(it)] = (c[kindOfItem(it)] || 0) + 1;
  return [
    c.commit && plural(c.commit, 'commit'),
    c.release && plural(c.release, 'release'),
    c.pull && plural(c.pull, 'pull request'),
    c.issue && plural(c.issue, 'issue'),
    c.event && plural(c.event, 'event'),
  ].filter(Boolean).join(', ');
}

function strip(html, n = 160) {
  const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const ACTION = { opened: 'opened', closed: 'closed', merged: 'merged', discussed: 'discussed' };

function Node({ item }) {
  const x = item.extra || {};
  const type = kindOfItem(item);
  const to = itemPath(item);
  const time = <time className={g.evTime} dateTime={new Date(item.published_at * 1000).toISOString()}>{hhmm(item.published_at)}</time>;

  if (type === 'commit') {
    return (
      <li className={g.ev} data-node="commit">
        <div className={g.evLine}>
          <Link to={to} className={g.evText}>{x.text || item.title}</Link>
          <SaveButton item={item} className={g.evSave} size={13} />
        </div>
        <div className={g.evMeta}>
          <Hash repo={x.repo} sha={x.sha} short={x.short} />
          {item.author && <Link to={userPath(item.author)} className={g.who}><Face src={item.thumbnail} login={item.author} size={16} />{item.author}</Link>}
          {time}
        </div>
      </li>
    );
  }
  if (type === 'release') {
    return (
      <li className={g.ev} data-node="tag">
        <div className={g.evLine}>
          <Link to={to} className={g.evTag}><TagLabel tag={x.tag} pre={x.prerelease} /></Link>
          {item.title && item.title !== x.tag && <Link to={to} className={g.evText}>{item.title}</Link>}
          <SaveButton item={item} className={g.evSave} size={13} />
        </div>
        {x.notes_html && <p className={g.evNote}>{strip(x.notes_html)}</p>}
        <div className={g.evMeta}><span>released</span>{time}</div>
      </li>
    );
  }
  if (type === 'issue' || type === 'pull') {
    return (
      <li className={g.ev} data-node={x.state === 'merged' ? 'merge' : 'ring'}>
        <div className={g.evLine}>
          <StateIcon kind={type} state={x.state} reason={x.state_reason} draft={x.draft} size={14} />
          <Link to={to} className={g.evText}><span className={g.num}>#{x.number}</span> {x.text || item.title}</Link>
          <SaveButton item={item} className={g.evSave} size={13} />
        </div>
        <div className={g.evMeta}>
          <span>{ACTION[x.action] || 'updated'}</span>
          {x.merge_sha && <Hash repo={x.repo} sha={x.merge_sha} />}
          {item.author && <Link to={userPath(item.author)} className={g.who}><Face src={item.thumbnail} login={item.author} size={16} />{item.author}</Link>}
          {x.labels?.slice(0, 3).map((l) => <Label key={l.name} {...l} />)}
          {x.comments > 0 && <span className={g.evCount}><MessageSquare size={11} />{compact(x.comments)}</span>}
          {time}
        </div>
      </li>
    );
  }
  const actor = x.actor || {};
  return (
    <li className={g.ev} data-node="event">
      <div className={g.evLine}>
        {actor.login && <Link to={userPath(actor.login)} className={g.who}><Face src={actor.avatar} login={actor.login} size={16} /><b>{actor.login}</b></Link>}
        {to ? <Link to={to} className={g.evText}>{x.text || item.title}</Link> : <a href={item.url} target="_blank" rel="noopener noreferrer" className={g.evText}>{x.text || item.title}</a>}
        <SaveButton item={item} className={g.evSave} size={13} />
      </div>
      {(x.title && !String(x.text || '').includes(x.title)) && <p className={g.evNote}>{x.title}</p>}
      {x.excerpt && <p className={g.evNote}>“{x.excerpt}”</p>}
      <div className={g.evMeta}>{x.head && <Hash repo={x.repo} sha={x.head} />}{x.ref && x.event_type === 'PushEvent' && <code className={g.ref}>{x.ref}</code>}{time}</div>
    </li>
  );
}

/** A squash-merged pull request also lands as a commit titled "… (#123)": keep
 *  the pull request and hang the commit's hash on it. */
function mergeSquashes(items) {
  const merged = new Map();
  for (const it of items) {
    if (kindOfItem(it) === 'pull' && it.extra?.state === 'merged') merged.set(it.extra.number, it);
  }
  if (!merged.size) return items;
  const out = [];
  for (const it of items) {
    const m = kindOfItem(it) === 'commit' && /\(#(\d+)\)\s*$/.exec(it.title || '');
    const pr = m && merged.get(Number(m[1]));
    if (pr) {
      pr.extra = { ...pr.extra, merge_sha: it.extra.sha };
      continue;
    }
    out.push(it);
  }
  return out;
}

function Branch({ repo, items: raw, lang }) {
  const [all, setAll] = useState(false);
  const [owner, name] = (repo || '/').split('/');
  const items = useMemo(() => mergeSquashes(raw.map((i) => ({ ...i }))), [raw]);
  // A busy repo's day is folded after the first few nodes; releases always show.
  const hidden = new Set();
  if (!all) {
    let shownCount = 0;
    for (const it of items) {
      if (kindOfItem(it) === 'release') continue;
      shownCount += 1;
      if (shownCount > SHOW) hidden.add(it.id);
    }
  }
  const shown = items.filter((i) => !hidden.has(i.id));
  return (
    <div className={g.branch} style={{ '--lane': laneColor(repo, lang) }}>
      <svg className={g.fork} viewBox="0 0 40 20" preserveAspectRatio="none" aria-hidden="true">
        <path d="M9 0 C9 12, 31 6, 31 20" />
      </svg>
      <div className={g.branchBody}>
        <div className={g.branchHead}>
          {repo ? (
            <Link to={repoPath(repo)} className={g.branchName}><span>{owner}/</span><b>{name}</b></Link>
          ) : <span className={g.branchName}>elsewhere</span>}
          <span className={g.branchTally}>{tally(items)}</span>
        </div>
        <ol className={g.events}>
          {shown.map((it) => <Node key={it.id} item={it} />)}
        </ol>
        {hidden.size > 0 && (
          <button type="button" className={g.branchMore} onClick={() => setAll(true)}>
            Show {hidden.size} more: {tally(items.filter((i) => hidden.has(i.id)))}
          </button>
        )}
      </div>
      <svg className={g.mergeBack} viewBox="0 0 40 20" preserveAspectRatio="none" aria-hidden="true">
        <path d="M31 0 C31 14, 9 8, 9 20" />
      </svg>
    </div>
  );
}

export default function Graph({ items, langOf = {} }) {
  const days = useMemo(() => {
    const out = [];
    const byDay = new Map();
    for (const it of items || []) {
      if (!it?.published_at) continue;
      const key = dayStart(it.published_at);
      let day = byDay.get(key);
      if (!day) {
        day = { key, repos: new Map(), count: 0 };
        byDay.set(key, day);
        out.push(day);
      }
      const repo = it.source || it.extra?.repo || '';
      if (!day.repos.has(repo)) day.repos.set(repo, []);
      day.repos.get(repo).push(it);
      day.count += 1;
    }
    out.sort((a, b) => b.key - a.key);
    return out;
  }, [items]);

  return (
    <div className={g.graph}>
      {days.map((d) => (
        <section key={d.key} className={g.day} aria-label={dayLabel(d.key)}>
          <h3 className={g.dayHead}>
            <span className={g.trunkNode} aria-hidden="true" />
            <b>{dayLabel(d.key)}</b>
            <small>{plural(d.count, 'change')} in {plural(d.repos.size, 'repository', 'repositories')}</small>
          </h3>
          {[...d.repos.entries()].map(([repo, list]) => (
            <Branch key={repo} repo={repo} items={list} lang={langOf[repo.toLowerCase()]} />
          ))}
        </section>
      ))}
    </div>
  );
}
