// The rows every list in the GitHub room is made of: a repository, an issue or
// pull request, a person. Each links to its page here and can be saved.

import { Link } from 'react-router-dom';
import { Archive, GitFork, Lock, MessageSquare, Star } from 'lucide-react';

import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { SaveButton } from '../ui/ItemActions.jsx';
import { Face, FollowHere, Label, LangDot, StarButton, StateIcon } from './bits.jsx';
import { langColor, repoPath, threadPath, userPath } from '../../lib/gh.js';
import g from './gh.module.css';

export function RepoName({ full, big = false }) {
  const [owner, name] = (full || '/').split('/');
  return (
    <span className={big ? `${g.repoName} ${g.repoNameBig}` : g.repoName}>
      <span className={g.owner}>{owner}</span><i>/</i><b>{name}</b>
    </span>
  );
}

/** A repository. `rank` numbers a ranked list; `gained` draws the trending bar
 *  against `maxGained`; `star` adds the GitHub star button; `follow` the
 *  follow-here one. */
export function RepoRow({ item, rank, maxGained, star = false, follow = false, note }) {
  const x = item.extra || {};
  const full = item.source;
  const lc = x.lang_color || langColor(x.language) || 'var(--rule-strong)';
  const when = x.starred_at ? `starred ${timeAgo(x.starred_at)} ago` : x.pushed_at ? `pushed ${timeAgo(x.pushed_at)} ago` : null;
  return (
    <article className={g.repoRow} style={{ '--lc': lc }}>
      {rank != null && <span className={g.rank}>{rank}</span>}
      <div className={g.repoMain}>
        <div className={g.repoTop}>
          <Link to={repoPath(full)} className={g.repoLink}><RepoName full={full} /></Link>
          {x.private && <span className={g.badge}><Lock size={10} /> private</span>}
          {x.archived && <span className={g.badge}><Archive size={10} /> archived</span>}
          {x.fork && <span className={g.badge}><GitFork size={10} /> fork</span>}
        </div>
        {x.description && <p className={g.repoDesc}>{x.description}</p>}
        <div className={g.repoMeta}>
          <LangDot lang={x.language} color={x.lang_color} />
          {x.stars != null && <span><Star size={11} /> {compact(x.stars)}</span>}
          {x.forks != null && x.forks > 0 && <span><GitFork size={11} /> {compact(x.forks)}</span>}
          {when && <span>{when}</span>}
          {x.topics?.slice(0, 3).map((t) => <span key={t} className={g.topic}>{t}</span>)}
          {x.built_by?.length > 0 && (
            <span className={g.builtBy} title="Built by">
              {x.built_by.map((b) => <Link key={b.login} to={userPath(b.login)} title={b.login}><Face src={b.avatar} login={b.login} size={18} /></Link>)}
            </span>
          )}
          {note}
        </div>
      </div>
      <div className={g.repoSide}>
        {x.stars_gained != null && (
          <span className={g.gained} title={`${x.stars_gained.toLocaleString()} stars in this window`}>
            <b>+{compact(x.stars_gained)}</b>
            {maxGained > 0 && <i style={{ '--w': `${Math.max(4, (x.stars_gained / maxGained) * 100)}%` }} />}
          </span>
        )}
        <span className={g.repoActs}>
          {star && <StarButton full={full} starred={x.starred_at ? true : undefined} count={null} />}
          {follow && <FollowHere sourceId={full} small />}
          <SaveButton item={item} className={g.rowSave} size={14} />
        </span>
      </div>
    </article>
  );
}

const ACTION_WORD = { opened: 'opened', closed: 'closed', merged: 'merged', discussed: 'updated' };

/** An issue or a pull request. `showRepo` names the repo (for lists that span many). */
export function IssueRow({ item, showRepo = true }) {
  const x = item.extra || {};
  const repo = x.repo || item.source;
  return (
    <article className={g.issueRow}>
      <StateIcon kind={x.kind} state={x.state} reason={x.state_reason} draft={x.draft} size={16} />
      <div className={g.issueMain}>
        <div className={g.issueTop}>
          <Link to={threadPath(repo, x.kind, x.number)} className={g.issueTitle}>{item.title}</Link>
          {x.labels?.slice(0, 4).map((l) => <Label key={l.name} {...l} />)}
        </div>
        <div className={g.issueMeta}>
          {showRepo && <Link to={repoPath(repo)} className={g.issueRepo}>{repo}</Link>}
          <span className={g.num}>#{x.number}</span>
          <span>
            {ACTION_WORD[x.action] || 'opened'} {timeAgo(item.published_at)} ago
            {item.author && <> by <Link to={userPath(item.author)}>{item.author}</Link></>}
          </span>
          {x.head && x.base && <code className={g.ref}>{x.head} → {x.base}</code>}
          {x.milestone && <span className={g.topic}>{x.milestone}</span>}
        </div>
      </div>
      <div className={g.issueSide}>
        {x.comments > 0 && <span className={g.evCount}><MessageSquare size={12} />{compact(x.comments)}</span>}
        {x.assignees?.length > 0 && (
          <span className={g.builtBy}>{x.assignees.slice(0, 3).map((a) => <Face key={a.login} src={a.avatar} login={a.login} size={18} />)}</span>
        )}
        <SaveButton item={item} className={g.rowSave} size={14} />
      </div>
    </article>
  );
}

/** A person or an organisation. */
export function PersonRow({ login, name, avatar, sub, item, follow = true }) {
  return (
    <article className={g.personRow}>
      <Link to={userPath(login)} className={g.personFace}><Face src={avatar} login={login} size={40} /></Link>
      <div className={g.personMain}>
        <Link to={userPath(login)} className={g.personName}>
          {name && name !== login ? <><b>{name}</b> <span>{login}</span></> : <b>{login}</b>}
        </Link>
        {sub}
      </div>
      <span className={g.repoActs}>
        {follow && <FollowHere sourceId={login} small />}
        {item && <SaveButton item={item} className={g.rowSave} size={14} />}
      </span>
    </article>
  );
}
