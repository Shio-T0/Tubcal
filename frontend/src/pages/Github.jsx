// GitHub (Coding channel). The room is a list of refs down the left — the views,
// marked the way `git branch` marks the one you're on — with the linked account
// and what's left of the API budget, and the view itself on the right:
//
//   activity   what the repos and people you follow did, drawn as a commit graph
//   releases   new versions across everything you follow (and star)
//   trending   github.com/trending, with the stars each gained
//   following  the repos and people followed here
//   clones     the GitHub checkouts in the Composing Room's workspace
//   inbox, work, stars   your notifications, open work and stars (account linked)
//
// Search sits over every view (?q=, scoped by ?in=). View state lives in the URL.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, Archive, Bell, BellOff, Check, CheckCheck, CircleCheck, CircleDot, CircleX, Code2, ExternalLink, FolderGit2,
  GitCommitHorizontal, GitMerge, GitPullRequest, Inbox, Plus, RefreshCw, Search, Star, Tag, TrendingUp, Users, X,
} from 'lucide-react';

import { hasModule } from '../lib/modules.js';
import { api, useApi } from '../api/client.js';
import { useDebounced } from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { Empty, Face, Failed, FollowHere, Hash, LangDot, Loading, More, TagLabel } from '../components/github/bits.jsx';
import Calendar from '../components/github/Calendar.jsx';
import GhHtml from '../components/github/GhHtml.jsx';
import Graph from '../components/github/Graph.jsx';
import LinkAccount from '../components/github/LinkAccount.jsx';
import { IssueRow, PersonRow, RepoName, RepoRow } from '../components/github/Rows.jsx';
import { REASONS, ghRoute, langColor, repoPath, shortDate, useGhAccount, userPath } from '../lib/gh.js';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { useShared } from '../lib/useShared.js';
import { useSubscriptions, useToast } from '../state.jsx';
import s from './github.module.css';

// ── the ref list ─────────────────────────────────────────────────────────────

const VIEWS = [
  { id: 'activity', label: 'Activity', Icon: GitCommitHorizontal },
  { id: 'releases', label: 'Releases', Icon: Tag },
  { id: 'trending', label: 'Trending', Icon: TrendingUp },
  { id: 'following', label: 'Following', Icon: Users },
  { id: 'clones', label: 'Clones', Icon: FolderGit2 },
];
const MINE = [
  { id: 'inbox', label: 'Inbox', Icon: Inbox },
  { id: 'work', label: 'Your work', Icon: GitPullRequest },
  { id: 'stars', label: 'Stars', Icon: Star },
];
export const GH_VIEWS = [...VIEWS, ...MINE];

function Budget({ budget }) {
  const core = budget?.buckets?.core;
  if (!core) return null;
  const share = core.limit ? core.remaining / core.limit : 0;
  const low = share < 0.15;
  return (
    <div className={`${s.budget} ${low ? s.budgetLow : ''}`} title={`Refills at ${new Date(core.reset * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}>
      <span className={s.budgetText}>
        <b>{core.remaining.toLocaleString()}</b> of {core.limit.toLocaleString()} API calls left this hour
      </span>
      <span className={s.budgetTrack}><i style={{ '--w': `${share * 100}%` }} /></span>
      {!budget.authenticated && <span className={s.budgetHint}>Linking an account raises it to 5,000.</span>}
    </div>
  );
}

function AccountCard({ me, linked, onLink }) {
  const cal = useShared(linked ? `/github/user/${me.login}/contributions` : '', { enabled: linked, maxAge: 600_000 });
  if (!linked) {
    return (
      <button type="button" className={s.linkCard} onClick={onLink}>
        <b>Link your GitHub account</b>
        <span>for your inbox, open work, stars and private repos</span>
      </button>
    );
  }
  return (
    <div className={s.me}>
      <Link to={userPath(me.login)} className={s.meWho}>
        <Face src={me.avatar} login={me.login} size={30} />
        <span><b>{me.login}</b>{me.name && <em>{me.name}</em>}</span>
      </Link>
      {cal.data && <Link to={userPath(me.login)} className={s.meCal} title="Your last 16 weeks"><Calendar data={cal.data} weeks={16} showStats={false} /></Link>}
    </div>
  );
}

function Refs({ view, setView, me, linked, counts, onLink }) {
  const row = (v) => {
    const on = v.id === view;
    const n = counts[v.id];
    return (
      <li key={v.id}>
        <button type="button" className={on ? `${s.ref} ${s.refOn}` : s.ref} onClick={() => setView(v.id)} aria-current={on ? 'page' : undefined}>
          <span className={s.refMark} aria-hidden="true">{on ? '*' : ''}</span>
          <v.Icon size={14} />
          <span className={s.refLabel}>{v.label}</span>
          {n ? <span className={v.id === 'inbox' ? `${s.refCount} ${s.refHot}` : s.refCount}>{n}</span> : null}
        </button>
      </li>
    );
  };
  return (
    <aside className={s.refs} aria-label="GitHub views">
      <AccountCard me={me} linked={linked} onLink={onLink} />
      <ul className={s.refList}>{VIEWS.map(row)}</ul>
      <ul className={s.refList}>
        <li className={s.refGroup}>{linked ? 'Yours' : 'Yours, once linked'}</li>
        {MINE.map(row)}
      </ul>
      <Budget budget={me?.budget} />
    </aside>
  );
}

// ── search ───────────────────────────────────────────────────────────────────

const SCOPES = [
  { id: 'repos', label: 'Repositories' },
  { id: 'users', label: 'People' },
  { id: 'issues', label: 'Issues & PRs' },
  { id: 'code', label: 'Code', linked: true },
];
const SORTS = {
  repos: [['', 'Best match'], ['stars', 'Most stars'], ['updated', 'Recently updated'], ['forks', 'Most forks']],
  users: [['', 'Best match'], ['followers', 'Most followers'], ['repositories', 'Most repositories']],
  issues: [['', 'Best match'], ['updated', 'Recently updated'], ['created', 'Newest'], ['comments', 'Most comments']],
  code: [['', 'Best match']],
};

function SearchBox({ q, setQ }) {
  const [text, setText] = useState(q);
  const navigate = useNavigate();
  const deb = useDebounced(text.trim(), 450);
  useEffect(() => setText(q), [q]);
  useEffect(() => { if (deb !== q && (deb.length >= 2 || !deb)) setQ(deb); }, [deb]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    // A pasted github.com link or a bare owner/repo goes straight there.
    const route = ghRoute(t) || (/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(t) ? repoPath(t) : null);
    if (route) navigate(route);
    else setQ(t);
  };
  return (
    <form className={s.search} onSubmit={submit} role="search">
      <Search size={16} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search GitHub, or paste owner/repo or a github.com link"
        aria-label="Search GitHub"
        spellCheck={false}
      />
      {text && <button type="button" onClick={() => { setText(''); setQ(''); }} aria-label="Clear the search"><X size={14} /></button>}
    </form>
  );
}

function SearchView({ q, linked }) {
  const [scope, setScope] = useParamState('in', 'repos');
  const [sort, setSort] = useParamState('sort', '');
  const [lang, setLang] = useParamState('lang', '');
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const path = `/github/search?q=${encodeURIComponent(q)}&in=${scope}${sort ? `&sort=${sort}` : ''}${lang ? `&language=${encodeURIComponent(lang)}` : ''}`;
  const res = useApi(`${path}&page=${page}`, scope !== 'code' || linked);
  useEffect(() => { setPages([]); setPage(0); }, [path]);
  useEffect(() => {
    if (res.data) setPages((p) => { const n = [...p]; n[page] = res.data.items; return n; });
  }, [res.data, page]);
  const items = pages.flat().filter(Boolean);
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <div className={s.chips} role="tablist">
          {SCOPES.map((sc) => (
            <button key={sc.id} type="button" role="tab" aria-selected={scope === sc.id} className={scope === sc.id ? s.chipOn : s.chip}
              onClick={() => { setScope(sc.id); setSort(''); }} disabled={sc.linked && !linked} title={sc.linked && !linked ? 'Searching code needs a linked account' : undefined}>
              {sc.label}
            </button>
          ))}
        </div>
        <span className={s.barRight}>
          {(scope === 'repos' || scope === 'code') && (
            <input className={s.langInput} value={lang} onChange={(e) => setLang(e.target.value)} placeholder="Language" aria-label="Language" />
          )}
          {SORTS[scope].length > 1 && (
            <select className={s.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              {SORTS[scope].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </span>
      </div>
      {res.data && <p className={s.count}>{(res.data.total || 0).toLocaleString()} result{res.data.total === 1 ? '' : 's'} for “{q}”</p>}
      {res.error && <Failed message={res.error} onRetry={res.reload} />}
      {!items.length && res.loading && <Loading label="Searching GitHub" />}
      {res.data && !items.length && !res.loading && <Empty>Nothing on GitHub matches “{q}”.</Empty>}
      <div className={s.list}>
        {items.map((it) => {
          if (scope === 'users') return <PersonRow key={it.id} login={it.extra.login} avatar={it.thumbnail} item={it} sub={<span className={s.dim}>{it.source}</span>} />;
          if (scope === 'issues') return <IssueRow key={it.id} item={it} />;
          if (scope === 'code') return <CodeHit key={it.id} item={it} />;
          return <RepoRow key={it.id} item={it} follow />;
        })}
      </div>
      {res.data?.has_more && <More busy={res.loading} onClick={() => setPage((p) => p + 1)} />}
    </section>
  );
}

function CodeHit({ item }) {
  const x = item.extra;
  return (
    <article className={s.codeHit}>
      <div className={s.codeHitHead}>
        <Link to={repoPath(x.repo)}><RepoName full={x.repo} /></Link>
        <Link to={repoPath(x.repo, { t: 'code', path: x.path })} className={s.codePath}>{x.path}</Link>
      </div>
      {x.fragments?.map((f, i) => <pre key={i} className={s.fragment}>{f}</pre>)}
    </article>
  );
}

// ── activity ─────────────────────────────────────────────────────────────────

function usePaged(base, enabled = true) {
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const sep = base.includes('?') ? '&' : '?';
  const res = useApi(`${base}${sep}page=${page}`, enabled && !!base);
  useEffect(() => { setPages([]); setPage(0); }, [base]);
  useEffect(() => {
    if (res.data) setPages((p) => { const n = [...p]; n[page] = res.data.items || []; return n; });
  }, [res.data, page]);
  return {
    items: pages.length ? pages.flat().filter(Boolean) : null,
    hasMore: !!res.data?.has_more,
    more: () => setPage((p) => p + 1),
    loading: res.loading,
    error: res.error,
    reload: () => { setPages([]); if (page === 0) res.reload(); else setPage(0); },
  };
}

function useLangMap() {
  const following = useShared('/github/following', { maxAge: 600_000 });
  return useMemo(() => {
    const m = {};
    for (const c of following.data?.items || []) {
      if (c.repo?.extra?.language) m[c.source_id.toLowerCase()] = c.repo.extra.language;
    }
    return m;
  }, [following.data]);
}

function Rail({ linked }) {
  const radar = useShared('/github/releases', { maxAge: 600_000 });
  const local = useShared('/github/local', { maxAge: 60_000 });
  const trend = useShared('/github/trending?period=daily', { maxAge: 600_000 });
  const dirty = (local.data?.items || []).filter((c) => c.changed || c.ahead || c.behind || c.upstream_status?.new).slice(0, 5);
  return (
    <aside className={s.rail}>
      {radar.data?.items?.length > 0 && (
        <section className={s.railBox}>
          <h4>Latest releases</h4>
          <ul className={s.railTags}>
            {radar.data.items.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link to={repoPath(r.source, { t: 'releases' })}>
                  <TagLabel tag={r.extra.tag} pre={r.extra.prerelease} />
                  <span className={s.railRepo}>{r.source}</span>
                </Link>
                <time>{shortDate(r.published_at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      {dirty.length > 0 && (
        <section className={s.railBox}>
          <h4>On this machine</h4>
          <ul className={s.railClones}>
            {dirty.map((c) => (
              <li key={c.path}>
                <Link to={repoPath(c.repo)}><b>{c.name}</b> <code>{c.branch}</code></Link>
                <CloneState c={c} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {trend.data?.items?.length > 0 && (
        <section className={s.railBox}>
          <h4>Trending today</h4>
          <ol className={s.railTrend}>
            {trend.data.items.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link to={repoPath(r.source)}><RepoName full={r.source} /></Link>
                <span>{r.extra.stars_gained != null ? `+${compact(r.extra.stars_gained)}` : compact(r.extra.stars)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!linked && <p className={s.railNote}>Link an account to add the people you follow on GitHub to this graph.</p>}
    </aside>
  );
}

function ActivityView({ linked, onAdd }) {
  const { subs } = useSubscriptions();
  const [src, setSrc] = useParamState('src', 'here');
  const fromGithub = src === 'github' && linked;
  const feed = usePaged(fromGithub ? '/github/received' : '/feed/github', fromGithub || subs.github.length > 0);
  const langOf = useLangMap();
  const toast = useToast();
  const refresh = async () => {
    try { await api('/refresh?scope=github', { method: 'POST' }); } catch { /* best-effort */ }
    feed.reload();
    toast('Fetching fresh activity', 'info');
  };
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <div className={s.chips}>
          <button type="button" className={!fromGithub ? s.chipOn : s.chip} onClick={() => setSrc('here')}>Followed here</button>
          <button type="button" className={fromGithub ? s.chipOn : s.chip} onClick={() => setSrc('github')} disabled={!linked}
            title={linked ? 'What the people and repos you follow on GitHub did' : 'Link an account to see your GitHub feed'}>
            Your GitHub feed
          </button>
        </div>
        <span className={s.barRight}>
          <button type="button" className={s.tool} onClick={onAdd}><Plus size={14} /> Follow a repo or person</button>
          <button type="button" className={s.toolIcon} onClick={refresh} title="Fetch fresh activity"><RefreshCw size={14} /></button>
        </span>
      </div>
      <div className={s.split}>
        <div className={s.main}>
          {!fromGithub && subs.github.length === 0 ? (
            <Empty action={<button type="button" className={s.tool} onClick={onAdd}><Plus size={14} /> Follow a repo or person</button>}>
              Follow repositories and people to see their commits, releases, issues and pull requests here, a branch per repo for each day.
              Anything on Trending can be followed from its row.
            </Empty>
          ) : (
            <>
              {feed.error && <Failed message={feed.error} onRetry={feed.reload} />}
              {!feed.items && feed.loading && <Loading label="Drawing the graph" />}
              {feed.items && feed.items.length === 0 && <Empty>Nothing new in the last two weeks.</Empty>}
              {feed.items && <Graph items={feed.items} langOf={langOf} />}
              {feed.hasMore && <More busy={feed.loading} onClick={feed.more}>Older activity</More>}
            </>
          )}
        </div>
        <Rail linked={linked} />
      </div>
    </section>
  );
}

// ── releases ─────────────────────────────────────────────────────────────────

function ReleasesView({ linked }) {
  const radar = useApi('/github/releases');
  const [which, setWhich] = useParamState('rf', 'all');
  const [pre, setPre] = useParamState('pre', '1');
  const [open, setOpen] = useState(() => new Set());
  const items = (radar.data?.items || [])
    .filter((r) => which === 'all' || (which === 'followed' ? r.extra.followed : !r.extra.followed))
    .filter((r) => pre === '1' || !r.extra.prerelease);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Group by week, newest first.
  const groups = useMemo(() => {
    const out = [];
    for (const r of items) {
      const d = new Date(r.published_at * 1000);
      const monday = new Date(d);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.getTime();
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, items: [] });
      out[out.length - 1].items.push(r);
    }
    return out;
  }, [items]);
  const weekLabel = (key) => {
    const thisWeek = new Date();
    thisWeek.setHours(0, 0, 0, 0);
    thisWeek.setDate(thisWeek.getDate() - ((thisWeek.getDay() + 6) % 7));
    if (key === thisWeek.getTime()) return 'This week';
    if (key === thisWeek.getTime() - 7 * 86400000) return 'Last week';
    return `Week of ${shortDate(key / 1000)}`;
  };
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <div className={s.chips}>
          {[['all', 'Everything'], ['followed', 'Followed here'], ['starred', 'Your stars']].map(([v, l]) => (
            <button key={v} type="button" className={which === v ? s.chipOn : s.chip} onClick={() => setWhich(v)} disabled={v === 'starred' && !linked}>{l}</button>
          ))}
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={pre === '1'} onChange={(e) => setPre(e.target.checked ? '1' : '0')} /> Pre-releases
        </label>
      </div>
      {radar.error && <Failed message={radar.error} onRetry={radar.reload} />}
      {radar.loading && !radar.data && <Loading label="Reading release feeds" />}
      {radar.data && !radar.data.repos && (
        <Empty>Follow repositories{linked ? ' or star them on GitHub' : ''} and their new versions will collect here.</Empty>
      )}
      {radar.data?.repos > 0 && !items.length && <Empty>No releases match.</Empty>}
      {groups.map((grp) => (
        <div key={grp.key} className={s.week}>
          <h3 className={s.weekHead}>{weekLabel(grp.key)}</h3>
          <ul className={s.rack}>
            {grp.items.map((r) => {
              const on = open.has(r.id);
              return (
                <li key={r.id} className={s.rackItem}>
                  <div className={s.rackTop}>
                    <TagLabel tag={r.extra.tag} pre={r.extra.prerelease} big />
                    <div className={s.rackText}>
                      <Link to={repoPath(r.source, { t: 'releases' })} className={s.rackRepo}><RepoName full={r.source} /></Link>
                      {r.title && r.title !== r.extra.tag && <span className={s.rackTitle}>{r.title}</span>}
                    </div>
                    <time className={s.rackTime}>{shortDate(r.published_at)}</time>
                    {r.extra.notes_html && (
                      <button type="button" className={s.tool} onClick={() => toggle(r.id)} aria-expanded={on}>{on ? 'Hide notes' : 'Notes'}</button>
                    )}
                    <SaveButton item={r} className={s.save} size={14} />
                  </div>
                  {on && <GhHtml html={r.extra.notes_html} className={s.notes} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ── trending ─────────────────────────────────────────────────────────────────

const LANGS = ['Python', 'TypeScript', 'JavaScript', 'Rust', 'Go', 'C++', 'C', 'Java', 'Kotlin', 'Swift', 'Zig', 'Shell', 'Lua', 'Nix', 'Haskell', 'Elixir'];
const PERIODS = [['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month']];

function TrendingView() {
  const [period, setPeriod] = useParamState('p', 'daily');
  const [lang, setLang] = useParamState('lang', '');
  const [kind, setKind] = useParamState('tk', 'repos');
  const qs = `period=${period}${lang ? `&language=${encodeURIComponent(lang)}` : ''}`;
  const repos = useApi(`/github/trending?${qs}`, kind === 'repos');
  const devs = useApi(`/github/trending/developers?${qs}`, kind === 'devs');
  const items = repos.data?.items || [];
  const maxGained = Math.max(0, ...items.map((i) => i.extra.stars_gained || 0));
  const word = { daily: 'today', weekly: 'this week', monthly: 'this month' }[period];
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <div className={s.chips}>
          {PERIODS.map(([v, l]) => <button key={v} type="button" className={period === v ? s.chipOn : s.chip} onClick={() => setPeriod(v)}>{l}</button>)}
        </div>
        <div className={s.chips}>
          <button type="button" className={kind === 'repos' ? s.chipOn : s.chip} onClick={() => setKind('repos')}>Repositories</button>
          <button type="button" className={kind === 'devs' ? s.chipOn : s.chip} onClick={() => setKind('devs')}>Developers</button>
        </div>
      </div>
      <div className={s.langs} role="radiogroup" aria-label="Language">
        <button type="button" role="radio" aria-checked={!lang} className={!lang ? s.langOn : s.langChip} onClick={() => setLang('')}>Any language</button>
        {LANGS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? s.langOn : s.langChip} onClick={() => setLang(l)}>
            <LangDot lang={l} />
          </button>
        ))}
        {lang && !LANGS.includes(lang) && <span className={s.langOn}><LangDot lang={lang} /></span>}
      </div>
      {kind === 'repos' ? (
        <>
          {repos.error && <Failed message={repos.error} onRetry={repos.reload} />}
          {repos.loading && !repos.data && <Loading label="Reading github.com/trending" />}
          {repos.data?.source === 'search' && (
            <p className={s.count}>github.com/trending couldn’t be read, so these are new repositories by stars instead.</p>
          )}
          {repos.data && !items.length && <Empty>Nothing trending {word}{lang ? ` in ${lang}` : ''}.</Empty>}
          {items.length > 0 && <p className={s.count}>Ranked by stars gained {word}{lang ? `, ${lang} only` : ''}.</p>}
          <div className={s.list}>
            {items.map((it, i) => <RepoRow key={it.id} item={it} rank={i + 1} maxGained={maxGained} follow star />)}
          </div>
        </>
      ) : (
        <>
          {devs.error && <Failed message={devs.error} onRetry={devs.reload} />}
          {devs.loading && !devs.data && <Loading label="Reading trending developers" />}
          <div className={s.list}>
            {(devs.data?.items || []).map((d, i) => (
              <div key={d.login} className={s.devRow}>
                <span className={s.rank}>{i + 1}</span>
                <PersonRow login={d.login} name={d.name} avatar={d.avatar} sub={d.repo && (
                  <span className={s.devRepo}>
                    <Link to={repoPath(d.repo)}><RepoName full={d.repo} /></Link>
                    {d.repo_description && <span>{d.repo_description}</span>}
                  </span>
                )} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── following ────────────────────────────────────────────────────────────────

function FollowingView({ onAdd }) {
  const res = useShared('/github/following', { maxAge: 120_000 });
  const { subs } = useSubscriptions();
  useEffect(() => { res.reload(); }, [subs.github.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const cards = res.data?.items || [];
  const repos = cards.filter((c) => c.kind === 'repo');
  const people = cards.filter((c) => c.kind === 'user');
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <span className={s.count}>{repos.length} repositor{repos.length === 1 ? 'y' : 'ies'} and {people.length} {people.length === 1 ? 'person' : 'people'} followed here</span>
        <button type="button" className={s.tool} onClick={onAdd}><Plus size={14} /> Follow a repo or person</button>
      </div>
      {res.error && <Failed message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && <Loading />}
      {res.data && !cards.length && (
        <Empty action={<button type="button" className={s.tool} onClick={onAdd}><Plus size={14} /> Follow a repo or person</button>}>
          Nothing followed yet. Following works without an account: it reads public activity and releases.
        </Empty>
      )}
      {repos.length > 0 && (
        <div className={s.cards}>
          {repos.map((c) => <RepoCard key={c.id} c={c} />)}
        </div>
      )}
      {people.length > 0 && (
        <>
          <h3 className={s.subHead}>People</h3>
          <div className={s.list}>
            {people.map((c) => (
              <PersonRow key={c.id} login={c.source_id} name={c.user?.extra?.name} avatar={c.user?.thumbnail || c.thumbnail} item={c.user}
                sub={<span className={s.dim}>{c.user?.extra?.bio || (c.error ? c.error : '')}</span>} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RepoCard({ c }) {
  const r = c.repo;
  const x = r?.extra || {};
  return (
    <article className={s.card} style={{ '--lc': langColor(x.language) || 'var(--rule-strong)' }}>
      <span className={s.cardLane} aria-hidden="true" />
      <header className={s.cardHead}>
        <Link to={repoPath(c.source_id)}><RepoName full={c.source_id} /></Link>
        <FollowHere sourceId={c.source_id} small />
      </header>
      {x.description && <p className={s.cardDesc}>{x.description}</p>}
      <div className={s.cardMeta}>
        <LangDot lang={x.language} />
        {x.stars != null && <span><Star size={11} /> {compact(x.stars)}</span>}
        {x.pushed_at ? <span>pushed {timeAgo(x.pushed_at)} ago</span> : null}
      </div>
      <div className={s.cardLast}>
        {c.release && (
          <Link to={repoPath(c.source_id, { t: 'releases' })} className={s.cardRel}>
            <TagLabel tag={c.release.extra.tag} pre={c.release.extra.prerelease} /> <time>{shortDate(c.release.published_at)}</time>
          </Link>
        )}
        {c.commit && (
          <span className={s.cardCommit}>
            <Hash repo={c.source_id} sha={c.commit.extra.sha} short={c.commit.extra.short} />
            <span>{c.commit.title}</span>
          </span>
        )}
      </div>
      {c.error && <p className={s.dim}>{c.error}</p>}
    </article>
  );
}

// ── clones ───────────────────────────────────────────────────────────────────

function CloneState({ c }) {
  const bits = [];
  if (c.changed) bits.push(<span key="c" className={s.cDirty} title="Changed files">✎ {c.changed}</span>);
  if (c.ahead) bits.push(<span key="a" className={s.cAhead} title="Commits not pushed">↑{c.ahead}</span>);
  if (c.behind) bits.push(<span key="b" className={s.cBehind} title="Fetched commits not merged">↓{c.behind}</span>);
  if (c.upstream_status?.new) bits.push(<span key="u" className={s.cBehind} title="New on GitHub since the last fetch">{c.upstream_status.new} new upstream</span>);
  if (c.gone) bits.push(<span key="g" className={s.cDirty}>upstream gone</span>);
  if (!bits.length) bits.push(<span key="ok" className={s.cClean}>in step</span>);
  return <span className={s.cState}>{bits}</span>;
}

function ClonesView() {
  const res = useApi('/github/local');
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [items, setItems] = useState(null);
  useEffect(() => { if (res.data) setItems(res.data.items); }, [res.data]);
  const fetchOne = async (c) => {
    setBusy(c.path);
    try {
      const fresh = await api('/github/local/fetch', { method: 'POST', body: JSON.stringify({ path: c.path }) });
      setItems((list) => list.map((x) => (x.path === c.path ? { ...x, ...fresh, upstream_status: null } : x)));
      toast(`Fetched ${c.name}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  if (res.data && !res.data.available) {
    return <section className={s.view}><Empty>git isn’t available here, so there are no local clones to show.</Empty></section>;
  }
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <span className={s.count}>{items ? `${items.length} GitHub checkout${items.length === 1 ? '' : 's'} in ${res.data?.workspace}` : ''}</span>
        <button type="button" className={s.toolIcon} onClick={res.reload} title="Look again"><RefreshCw size={14} /></button>
      </div>
      {res.error && <Failed message={res.error} onRetry={res.reload} />}
      {res.loading && !items && <Loading label="Looking through the workspace" />}
      {items && !items.length && <Empty>No GitHub checkouts in {res.data?.workspace}. Any repository page here can clone one.</Empty>}
      {items?.length > 0 && (
        <div className={s.clones} role="table" aria-label="Clones">
          {items.map((c) => (
            <div key={c.path} className={s.clone} role="row">
              <span className={s.cName}>
                <b>{c.path}</b>
                <Link to={repoPath(c.repo)} className={s.cRepo}>{c.repo}</Link>
              </span>
              <span className={s.cBranch}>
                <code>{c.detached ? 'detached' : c.branch || '?'}</code>
                {c.upstream && c.upstream !== `${c.remote}/${c.branch}` && <span className={s.dim}>→ {c.upstream}</span>}
                {!c.upstream && !c.detached && <span className={s.dim}>not pushed</span>}
              </span>
              <CloneState c={c} />
              <span className={s.cLast} title={c.head}>
                {c.subject && <><Hash sha={c.head} short={c.head_short} /> {c.subject}</>}
                {c.head_time ? <time> {timeAgo(c.head_time)} ago</time> : null}
              </span>
              <span className={s.cActs}>
                {hasModule('editor') && <Link className={s.tool} to={`/editor?open=${encodeURIComponent(c.open || c.path)}`} title="Open in the Composing Room"><Code2 size={13} /> Open</Link>}
                <button type="button" className={s.tool} onClick={() => fetchOne(c)} disabled={busy === c.path} title="git fetch: updates what’s known about the remote, never your files">
                  <RefreshCw size={13} className={busy === c.path ? s.spin : ''} /> Fetch
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── the inbox ────────────────────────────────────────────────────────────────

const TYPE_ICON = { PullRequest: GitPullRequest, Issue: CircleDot, Release: Tag, Commit: GitCommitHorizontal, Discussion: Users };

/** A notification's icon: its subject's kind, or for a workflow run how it ended. */
function noteIcon(n) {
  if (n.type === 'CheckSuite') {
    if (/fail|cancel|timed out/i.test(n.title)) return [CircleX, s.noteBad];
    if (/succeed|pass|success/i.test(n.title)) return [CircleCheck, s.noteGood];
    return [Activity, null];
  }
  return [TYPE_ICON[n.type] || Bell, null];
}

function NeedsAccount({ me, reload, what }) {
  return (
    <section className={s.view}>
      <div className={s.needs}>
        <h3>{what} needs a linked GitHub account</h3>
        <LinkAccount me={me} onChanged={reload} />
      </div>
    </section>
  );
}

function InboxView({ me }) {
  const [f, setF] = useParamState('f', 'unread');
  const navigate = useNavigate();
  const toast = useToast();
  const count = useShared('/github/inbox/count', { maxAge: 60_000 });
  const feed = usePaged(`/github/inbox?all=${f === 'all' ? 1 : 0}&participating=${f === 'mine' ? 1 : 0}`, true);
  const [gone, setGone] = useState(() => new Set());
  const [read, setRead] = useState(() => new Set());
  const items = (feed.items || []).filter((n) => !gone.has(n.id));
  const groups = useMemo(() => {
    const m = new Map();
    for (const n of items) {
      if (!m.has(n.repo)) m.set(n.repo, []);
      m.get(n.repo).push(n);
    }
    return [...m.entries()];
  }, [items]);

  const act = async (n, how) => {
    try {
      if (how === 'read') { setRead((r) => new Set(r).add(n.id)); await api(`/github/inbox/${n.id}`, { method: 'PATCH' }); }
      if (how === 'done') { setGone((r) => new Set(r).add(n.id)); await api(`/github/inbox/${n.id}`, { method: 'DELETE' }); }
      if (how === 'mute') { setGone((r) => new Set(r).add(n.id)); await api(`/github/inbox/${n.id}/mute`, { method: 'PUT' }); toast('Muted: no more notifications from this thread', 'success'); }
      count.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const allRead = async (repo) => {
    try {
      await api('/github/inbox', { method: 'PUT', body: JSON.stringify(repo ? { repo } : {}) });
      const ids = items.filter((n) => !repo || n.repo === repo).map((n) => n.id);
      setRead((r) => new Set([...r, ...ids]));
      toast(repo ? `Marked ${repo} read` : 'Marked everything read', 'success');
      count.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const open = (n) => {
    if (n.unread && !read.has(n.id)) act(n, 'read');
    const t = n.target;
    if (t.kind === 'issue' || t.kind === 'pull' || t.kind === 'commit') navigate(ghRoute(t.html_url));
    else window.open(t.html_url, '_blank', 'noopener');
  };

  if (!me.can?.notifications) {
    return (
      <section className={s.view}>
        <Empty>
          The linked token can’t read notifications. {me.can?.fine_grained
            ? 'GitHub doesn’t open notifications to fine-grained tokens; link a classic token or the GitHub CLI instead.'
            : 'It needs the notifications (or repo) scope.'}
        </Empty>
      </section>
    );
  }
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <div className={s.chips}>
          {[['unread', 'Unread'], ['mine', 'Participating'], ['all', 'Everything']].map(([v, l]) => (
            <button key={v} type="button" className={f === v ? s.chipOn : s.chip} onClick={() => setF(v)}>{l}</button>
          ))}
        </div>
        <span className={s.barRight}>
          <button type="button" className={s.tool} onClick={() => allRead(null)} disabled={!items.some((n) => n.unread && !read.has(n.id))}>
            <CheckCheck size={14} /> Mark all read
          </button>
          <button type="button" className={s.toolIcon} onClick={feed.reload} title="Check again"><RefreshCw size={14} /></button>
        </span>
      </div>
      {feed.error && <Failed message={feed.error} onRetry={feed.reload} />}
      {!feed.items && feed.loading && <Loading label="Opening the inbox" />}
      {feed.items && !items.length && <Empty>{f === 'unread' ? 'Nothing unread. ' : ''}The inbox is empty.</Empty>}
      {groups.map(([repo, list]) => (
        <div key={repo} className={s.inGroup}>
          <header className={s.inHead}>
            <Face src={list[0].repo_avatar} login={repo} size={18} square />
            <Link to={repoPath(repo)}><RepoName full={repo} /></Link>
            <span className={s.dim}>{list.length}</span>
            {list.some((n) => n.unread && !read.has(n.id)) && (
              <button type="button" className={s.toolQuiet} onClick={() => allRead(repo)}>Mark read</button>
            )}
          </header>
          <ul className={s.inList}>
            {list.map((n) => {
              const [Icon, tone] = noteIcon(n);
              const unread = n.unread && !read.has(n.id);
              return (
                <li key={n.id} className={unread ? `${s.note} ${s.noteUnread}` : s.note}>
                  <button type="button" className={s.noteMain} onClick={() => open(n)}>
                    <Icon size={15} className={`${s.noteIcon} ${tone || ''}`} />
                    <span className={s.noteTitle}>{n.title}</span>
                    <span className={s.reason}>{REASONS[n.reason] || n.reason}</span>
                    <time className={s.dim}>{timeAgo(n.updated_at)}</time>
                  </button>
                  <span className={s.noteActs}>
                    {unread && <button type="button" onClick={() => act(n, 'read')} title="Mark read" aria-label="Mark read"><Check size={14} /></button>}
                    <button type="button" onClick={() => act(n, 'done')} title="Done: take it out of the inbox" aria-label="Done"><Archive size={14} /></button>
                    <button type="button" onClick={() => act(n, 'mute')} title="Mute this thread" aria-label="Mute"><BellOff size={14} /></button>
                    {n.target.html_url && <a href={n.target.html_url} target="_blank" rel="noopener noreferrer" title="Open on GitHub" aria-label="Open on GitHub"><ExternalLink size={14} /></a>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {feed.hasMore && <More busy={feed.loading} onClick={feed.more} />}
    </section>
  );
}

// ── your work ────────────────────────────────────────────────────────────────

const WORK = [
  ['review', 'Waiting for your review', GitPullRequest],
  ['pulls', 'Your open pull requests', GitMerge],
  ['assigned', 'Assigned to you', CircleDot],
  ['mentioned', 'Mentioning you', Bell],
];

function WorkView({ me }) {
  const work = useApi('/github/work');
  const repos = usePaged('/github/mine/repos?sort=pushed', true);
  return (
    <section className={s.view}>
      {work.error && <Failed message={work.error} onRetry={work.reload} />}
      {work.loading && !work.data && <Loading label="Gathering your open work" />}
      {work.data && WORK.every(([key]) => !work.data[key]?.total && !work.data[key]?.error) && (
        <p className={s.allClear}>Nothing is waiting on you: no reviews requested, no open pull requests, nothing assigned and no open mentions.</p>
      )}
      {work.data && WORK.some(([key]) => work.data[key]?.total || work.data[key]?.error) && (
        <div className={s.work}>
          {WORK.map(([key, title, Icon]) => {
            const box = work.data[key] || { items: [], total: 0 };
            return (
              <section key={key} className={s.workBox}>
                <h3><Icon size={15} /> {title} <span className={s.dim}>{box.total}</span></h3>
                {box.error && <p className={s.dim}>{box.error}</p>}
                {!box.error && !box.items.length && <p className={s.dim}>None.</p>}
                <div className={s.list}>{box.items.map((it) => <IssueRow key={it.id} item={it} />)}</div>
              </section>
            );
          })}
        </div>
      )}
      <h3 className={s.subHead}>Your repositories</h3>
      {repos.error && <Failed message={repos.error} onRetry={repos.reload} />}
      {!repos.items && repos.loading && <Loading />}
      <div className={s.list}>{(repos.items || []).map((it) => <RepoRow key={it.id} item={it} />)}</div>
      {repos.hasMore && <More busy={repos.loading} onClick={repos.more} />}
      <p className={s.dim}><Link to={userPath(me.login)}>Your profile and contribution year</Link></p>
    </section>
  );
}

// ── stars ────────────────────────────────────────────────────────────────────

function StarsView() {
  const feed = usePaged('/github/stars', true);
  const [lang, setLang] = useParamState('lang', '');
  const [text, setText] = useState('');
  const items = feed.items || [];
  const langs = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it.extra.language) m.set(it.extra.language, (m.get(it.extra.language) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [items]);
  const t = text.trim().toLowerCase();
  const shown = items.filter((it) => (!lang || it.extra.language === lang)
    && (!t || `${it.source} ${it.extra.description} ${(it.extra.topics || []).join(' ')}`.toLowerCase().includes(t)));
  return (
    <section className={s.view}>
      <div className={s.bar}>
        <input className={s.filter} value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter your stars" aria-label="Filter your stars" />
        <span className={s.count}>{shown.length} of {items.length}{feed.hasMore ? '+' : ''}</span>
      </div>
      {langs.length > 1 && (
        <div className={s.langs}>
          <button type="button" className={!lang ? s.langOn : s.langChip} onClick={() => setLang('')}>All</button>
          {langs.map(([l, n]) => (
            <button key={l} type="button" className={lang === l ? s.langOn : s.langChip} onClick={() => setLang(l)}><LangDot lang={l} /> <em>{n}</em></button>
          ))}
        </div>
      )}
      {feed.error && <Failed message={feed.error} onRetry={feed.reload} />}
      {!feed.items && feed.loading && <Loading label="Fetching your stars" />}
      {feed.items && !items.length && <Empty>You haven’t starred anything on GitHub yet.</Empty>}
      <div className={s.list}>{shown.map((it) => <RepoRow key={it.id} item={it} star />)}</div>
      {feed.hasMore && <More busy={feed.loading} onClick={feed.more}>Older stars</More>}
    </section>
  );
}

// ── the room ─────────────────────────────────────────────────────────────────

export default function Github() {
  const [view, setView] = useParamState('v', 'activity');
  const [q, setQ] = useParamState('q', '');
  const { me, linked, reload } = useGhAccount();
  const { subs } = useSubscriptions();
  const [addOpen, setAddOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const count = useShared('/github/inbox/count', { enabled: linked, maxAge: 60_000 });
  const local = useShared('/github/local', { maxAge: 60_000 });
  const counts = {
    following: subs.github.length || null,
    clones: local.data?.items?.length || null,
    inbox: count.data?.unread ? `${count.data.unread}${count.data.more ? '+' : ''}` : null,
  };
  const known = GH_VIEWS.some((v) => v.id === view) ? view : 'activity';
  const mine = MINE.some((v) => v.id === known);
  const go = (v) => { setQ(''); setView(v); };

  let body;
  if (q) body = <SearchView q={q} linked={linked} />;
  else if (mine && !linked) body = me ? <NeedsAccount me={me} reload={reload} what={MINE.find((m) => m.id === known).label} /> : <Loading />;
  else if (known === 'releases') body = <ReleasesView linked={linked} />;
  else if (known === 'trending') body = <TrendingView />;
  else if (known === 'following') body = <FollowingView onAdd={() => setAddOpen(true)} />;
  else if (known === 'clones') body = <ClonesView />;
  else if (known === 'inbox') body = <InboxView me={me} />;
  else if (known === 'work') body = <WorkView me={me} />;
  else if (known === 'stars') body = <StarsView />;
  else body = <ActivityView linked={linked} onAdd={() => setAddOpen(true)} />;

  return (
    <div className={s.room}>
      <Refs view={q ? null : known} setView={go} me={me} linked={linked} counts={counts} onLink={() => setLinkOpen((o) => !o)} />
      <div className={s.stage}>
        <SearchBox q={q} setQ={setQ} />
        {linkOpen && !linked && me && (
          <div className={s.linkSheet}>
            <header><h3>Link your GitHub account</h3><button type="button" onClick={() => setLinkOpen(false)} aria-label="Close"><X size={16} /></button></header>
            <LinkAccount me={me} onChanged={() => { reload(); setLinkOpen(false); }} />
          </div>
        )}
        {body}
      </div>
      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} initialPlatform="github" />
    </div>
  );
}
