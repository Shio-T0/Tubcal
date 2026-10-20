// A GitHub repository, read in place: its name plate (owner / name, what it is,
// its languages as one bar), then tabs (?t=) for the README, the code, the
// commits, issues, pull requests, releases and the people who built it — with
// the facts down the side: numbers, licence, a year of commits as a ridge, and
// whether it's cloned on this machine (or a button that clones it).
//
// Also here: a thread (an issue or pull request with its conversation, and a PR's
// changed files) and a commit (its message and diff).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, Code2, Copy, Download, ExternalLink, File, FileCode, Folder, FolderGit2, GitBranch, GitCommitHorizontal,
  GitFork, Globe, Image as ImageIcon, Lock, MessageSquare, RefreshCw, Scale, ShieldCheck, Star, Tag, Users,
} from 'lucide-react';

import { hasModule } from '../lib/modules.js';
import { api, useApi } from '../api/client.js';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import {
  DiffStat, Empty, Face, Failed, FollowHere, Hash, Label, LangBar, Loading, More, StarButton, StatePill, TagLabel,
} from '../components/github/bits.jsx';
import CodeView from '../components/github/Code.jsx';
import DiffView from '../components/github/Diff.jsx';
import GhHtml from '../components/github/GhHtml.jsx';
import { IssueRow, RepoName } from '../components/github/Rows.jsx';
import {
  bytes, codePath, commitPath, langColor, repoPath, shortDate, threadPath, useGhAccount, userPath,
} from '../lib/gh.js';
import { compact } from '../lib/format.js';
import { pageItem } from '../lib/saveable.js';
import { timeAgo } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { useShared } from '../lib/useShared.js';
import { useToast } from '../state.jsx';
import p from './ghpages.module.css';

// The Composing Room opens local copies, when this copy has it.
const EDITOR = hasModule('editor');

// ── shared bits ──────────────────────────────────────────────────────────────

function usePagedList(base, enabled = true) {
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const sep = base.includes('?') ? '&' : '?';
  const res = useApi(`${base}${sep}page=${page}`, enabled);
  useEffect(() => { setPages([]); setPage(0); }, [base]);
  useEffect(() => {
    if (res.data) setPages((x) => { const n = [...x]; n[page] = res.data.items || []; return n; });
  }, [res.data, page]);
  return { items: pages.length ? pages.flat().filter(Boolean) : null, hasMore: !!res.data?.has_more, more: () => setPage((x) => x + 1), loading: res.loading, error: res.error, reload: res.reload };
}

function Tabs({ tabs, value, onChange }) {
  return (
    <nav className={p.tabs} role="tablist">
      {tabs.map(([id, label, Icon, n]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? p.tabOn : p.tab} onClick={() => onChange(id)}>
          {Icon && <Icon size={14} />}
          {label}
          {n != null && n !== '' && <em>{n}</em>}
        </button>
      ))}
    </nav>
  );
}

function Ridge({ weeks }) {
  if (!weeks?.length) return null;
  const max = Math.max(1, ...weeks);
  const w = 4;
  const h = 36;
  const total = weeks.reduce((a, b) => a + b, 0);
  return (
    <figure className={p.ridge}>
      <svg viewBox={`0 0 ${weeks.length * w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img"
        aria-label={`${total.toLocaleString()} commits in the last year`}>
        {weeks.map((n, i) => {
          const bh = n ? Math.max(2, (n / max) * h) : 1;
          return <rect key={i} x={i * w} y={h - bh} width={w - 1} height={bh} rx={1}><title>{n} commit{n === 1 ? '' : 's'}, {52 - i} week{52 - i === 1 ? '' : 's'} ago</title></rect>;
        })}
      </svg>
      <figcaption>{total.toLocaleString()} commits in the last 52 weeks</figcaption>
    </figure>
  );
}

// ── cloning ──────────────────────────────────────────────────────────────────

function LocalPanel({ full, data, onChanged }) {
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const local = data.local;

  const poll = (id) => {
    timer.current = setTimeout(async () => {
      try {
        const j = await api(`/github/clone/${id}`);
        setJob(j);
        if (j.state === 'running') poll(id);
        else if (j.state === 'done') { toast(`Cloned into ${j.path}`, 'success'); onChanged(); }
        else toast(j.error || 'The clone failed', 'error');
      } catch (e) {
        toast(e.message, 'error');
      }
    }, 700);
  };
  const clone = async () => {
    try {
      const j = await api('/github/clone', { method: 'POST', body: JSON.stringify({ repo: full, private: !!data.repo?.extra?.private }) });
      setJob(j);
      if (j.state === 'running') poll(j.id);
      if (j.state === 'exists') onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const fetchNow = async () => {
    setBusy(true);
    try {
      await api('/github/local/fetch', { method: 'POST', body: JSON.stringify({ path: local.path }) });
      toast('Fetched', 'success');
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (local) {
    return (
      <section className={p.fact}>
        <h4><FolderGit2 size={14} /> On this machine</h4>
        <p className={p.localPath}>{local.path}</p>
        <p className={p.localState}>
          <code>{local.branch || 'detached'}</code>
          {local.changed ? <span className={p.warn}>✎ {local.changed} changed</span> : null}
          {local.ahead ? <span>↑{local.ahead}</span> : null}
          {local.behind ? <span className={p.warn}>↓{local.behind}</span> : null}
          {!local.changed && !local.ahead && !local.behind && <span className={p.ok}>clean</span>}
        </p>
        <div className={p.factActs}>
          {EDITOR && <Link className={p.btnSolid} to={`/editor?open=${encodeURIComponent(local.open || local.path)}`}><Code2 size={14} /> Open in the editor</Link>}
          <button type="button" className={p.btnGhost} onClick={fetchNow} disabled={busy}><RefreshCw size={13} className={busy ? p.spin : ''} /> Fetch</button>
        </div>
      </section>
    );
  }
  if (!data.clone_available) return null;
  return (
    <section className={p.fact}>
      <h4><FolderGit2 size={14} /> On this machine</h4>
      {job?.state === 'running' ? (
        <div className={p.progress}>
          <span>{job.phase}… {job.percent}%</span>
          <span className={p.track}><i style={{ '--w': `${job.percent}%` }} /></span>
        </div>
      ) : job?.state === 'done' || job?.state === 'exists' ? (
        EDITOR
          ? <Link className={p.btnSolid} to={`/editor?open=${encodeURIComponent(job.open || job.path)}`}><Code2 size={14} /> Open in the editor</Link>
          : <span className={p.ok}>cloned to {job.path}</span>
      ) : (
        <>
          <p className={p.dim}>Not cloned. Cloning puts it in the Composing Room’s workspace, history and all.</p>
          {job?.state === 'failed' && <p className={p.warn}>{job.error}</p>}
          <button type="button" className={p.btnSolid} onClick={clone}><Download size={14} /> Clone into the workspace</button>
        </>
      )}
    </section>
  );
}

// ── the code tab ─────────────────────────────────────────────────────────────

function Crumbs({ full, path, refName }) {
  const parts = path ? path.split('/') : [];
  const [, name] = full.split('/');
  return (
    <nav className={p.crumbs} aria-label="Path">
      <Link to={codePath(full, '', refName)}>{name}</Link>
      {parts.map((seg, i) => (
        <span key={i}>
          <ChevronRight size={12} />
          {i === parts.length - 1 ? <b>{seg}</b> : <Link to={codePath(full, parts.slice(0, i + 1).join('/'), refName)}>{seg}</Link>}
        </span>
      ))}
    </nav>
  );
}

function RefPicker({ full, value, fallback }) {
  const [open, setOpen] = useState(false);
  const branches = useShared(open ? `/github/repo/${full}/branches` : '', { enabled: open, maxAge: 600_000 });
  const [, setParams] = useSearchParams();
  const pick = (name) => {
    const next = new URLSearchParams(window.location.search);
    if (!name || name === fallback) next.delete('ref'); else next.set('ref', name);
    setParams(next, { replace: true });
    setOpen(false);
  };
  return (
    <span className={p.refPick}>
      <button type="button" className={p.refBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <GitBranch size={13} /> {value || fallback}
      </button>
      {open && (
        <div className={p.refMenu} role="listbox">
          {branches.loading && <span className={p.dim}>Loading branches…</span>}
          {(branches.data?.items || []).map((b) => (
            <button key={b.name} type="button" role="option" aria-selected={(value || fallback) === b.name} onClick={() => pick(b.name)}>
              {b.name}{b.name === fallback && <em>default</em>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function FileBody({ full, blob, refName, local }) {
  const toast = useToast();
  const [mode, setMode] = useState('preview');
  const rendered = useApi(`/github/repo/${full}/file?path=${encodeURIComponent(blob.path)}${refName ? `&ref=${encodeURIComponent(refName)}` : ''}&render=1`, blob.markup && mode === 'preview');
  const dir = blob.path.includes('/') ? blob.path.slice(0, blob.path.lastIndexOf('/')) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Link copied', 'success'); } catch { toast(window.location.href, 'info'); }
  };
  return (
    <div className={p.file}>
      <header className={p.fileHead}>
        <span className={p.fileName}><FileCode size={14} /> {blob.name}</span>
        <span className={p.dim}>{blob.lines ? `${blob.lines.toLocaleString()} lines, ` : ''}{bytes(blob.size)}</span>
        {blob.markup && blob.text != null && (
          <span className={p.seg}>
            <button type="button" className={mode === 'preview' ? p.segOn : ''} onClick={() => setMode('preview')}>Preview</button>
            <button type="button" className={mode === 'source' ? p.segOn : ''} onClick={() => setMode('source')}>Source</button>
          </span>
        )}
        <span className={p.fileActs}>
          {local && EDITOR && <Link to={`/editor?open=${encodeURIComponent(`${local.path}/${blob.path}`)}`} title="Open your local copy in the Composing Room"><Code2 size={14} /> Edit locally</Link>}
          <button type="button" onClick={copy} title="Copy a link to this file (and the marked lines)"><Copy size={14} /></button>
          {blob.download_url && <a href={blob.download_url} target="_blank" rel="noopener noreferrer" title="Raw file"><Download size={14} /></a>}
          {blob.html_url && <a href={blob.html_url} target="_blank" rel="noopener noreferrer" title="Open on GitHub"><ExternalLink size={14} /></a>}
          <SaveButton item={pageItem(`${window.location.pathname}${window.location.search}`, `${blob.path} — ${full}`)} size={14} />
        </span>
      </header>
      {blob.image ? (
        <div className={p.fileImage}><img src={blob.download_url} alt={blob.name} /></div>
      ) : blob.too_large ? (
        <Empty action={blob.html_url && <a className={p.btnGhost} href={blob.html_url} target="_blank" rel="noopener noreferrer">Open on GitHub</a>}>
          This file is {bytes(blob.size)}, too large to show here.
        </Empty>
      ) : blob.binary ? (
        <Empty action={blob.download_url && <a className={p.btnGhost} href={blob.download_url}>Download</a>}>A binary file ({bytes(blob.size)}).</Empty>
      ) : blob.markup && mode === 'preview' ? (
        rendered.data?.html ? <GhHtml html={rendered.data.html} repo={full} dir={dir} refName={refName} className={p.mdFile} /> : rendered.error ? <CodeView text={blob.text || ''} name={blob.name} /> : <Loading label="Rendering" />
      ) : (
        <CodeView text={blob.text || ''} name={blob.name} />
      )}
    </div>
  );
}

const ICONS = { dir: Folder, submodule: FolderGit2, symlink: File, file: File };
const isImage = (n) => /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i.test(n);

function CodeTab({ full, data }) {
  const [path] = useParamState('path', '');
  const [refName] = useParamState('ref', '');
  const fallback = data.repo?.extra?.default_branch || 'main';
  const res = useApi(`/github/repo/${full}/tree?path=${encodeURIComponent(path)}${refName ? `&ref=${encodeURIComponent(refName)}` : ''}`);
  const entries = res.data?.entries || [];
  const readme = !res.data?.file && entries.find((e) => e.type === 'file' && /^readme(\.|$)/i.test(e.name));
  const readmeRes = useApi(readme ? `/github/repo/${full}/file?path=${encodeURIComponent(readme.path)}${refName ? `&ref=${encodeURIComponent(refName)}` : ''}&render=1` : '', !!readme && !!path);
  return (
    <div className={p.codeTab}>
      <div className={p.codeBar}>
        <RefPicker full={full} value={refName} fallback={fallback} />
        <Crumbs full={full} path={path} refName={refName} />
        {path && (
          <Link className={p.history} to={repoPath(full, { t: 'commits', path, ref: refName || null })}><GitCommitHorizontal size={13} /> History</Link>
        )}
      </div>
      {res.error && <Failed message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && <Loading />}
      {res.data?.file && res.data.blob && <FileBody full={full} blob={res.data.blob} refName={refName} local={data.local} />}
      {res.data && !res.data.file && (
        <>
          <ul className={p.listing}>
            {path && (
              <li><Link to={codePath(full, path.split('/').slice(0, -1).join('/'), refName)} className={p.entry}><Folder size={15} /> <span>..</span></Link></li>
            )}
            {entries.map((e) => {
              const Icon = isImage(e.name) ? ImageIcon : ICONS[e.type] || File;
              return (
                <li key={e.path}>
                  <Link to={codePath(full, e.path, refName)} className={`${p.entry} ${e.type === 'dir' ? p.entryDir : ''}`}>
                    <Icon size={15} /> <span>{e.name}</span>
                    {e.type === 'file' && <em>{bytes(e.size)}</em>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {readme && path && readmeRes.data?.html && (
            <div className={p.dirReadme}>
              <h4>{readme.name}</h4>
              <GhHtml html={readmeRes.data.html} repo={full} dir={path} refName={refName} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── commits ──────────────────────────────────────────────────────────────────

function CommitsTab({ full }) {
  const [refName] = useParamState('ref', '');
  const [path] = useParamState('path', '');
  const list = usePagedList(`/github/repo/${full}/commits?${new URLSearchParams({ ...(refName && { ref: refName }), ...(path && { path }) })}`);
  const days = useMemo(() => {
    const out = [];
    for (const c of list.items || []) {
      const d = new Date(c.published_at * 1000).toDateString();
      if (!out.length || out[out.length - 1].d !== d) out.push({ d, at: c.published_at, items: [] });
      out[out.length - 1].items.push(c);
    }
    return out;
  }, [list.items]);
  return (
    <div>
      {path && <p className={p.dim}>History of <code>{path}</code></p>}
      {list.error && <Failed message={list.error} onRetry={list.reload} />}
      {!list.items && list.loading && <Loading />}
      <div className={p.lane}>
        {days.map((day) => (
          <section key={day.d} className={p.laneDay}>
            <h4>{shortDate(day.at)}</h4>
            <ol>
              {day.items.map((c) => (
                <li key={c.id} className={p.laneItem} data-node={c.extra.parents > 1 ? 'merge' : 'commit'}>
                  <Link to={commitPath(full, c.extra.sha)} className={p.laneText}>{c.title}</Link>
                  <span className={p.laneMeta}>
                    <Hash repo={full} sha={c.extra.sha} short={c.extra.short} />
                    {c.author && <Link to={userPath(c.author)} className={p.who}><Face src={c.thumbnail} login={c.author} size={16} />{c.author}</Link>}
                    {c.extra.verified && <span className={p.ok} title="Signed and verified"><ShieldCheck size={12} /></span>}
                    <time>{timeAgo(c.published_at)} ago</time>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {list.hasMore && <More busy={list.loading} onClick={list.more}>Older commits</More>}
    </div>
  );
}

// ── issues, pulls, releases, people ─────────────────────────────────────────

function ThreadsTab({ full, kind }) {
  const [state, setState] = useParamState('state', 'open');
  const list = usePagedList(`/github/repo/${full}/issues?kind=${kind}&state=${state}`);
  return (
    <div>
      <div className={p.subBar}>
        {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([v, l]) => (
          <button key={v} type="button" className={state === v ? p.chipOn : p.chip} onClick={() => setState(v)}>{l}</button>
        ))}
      </div>
      {list.error && <Failed message={list.error} onRetry={list.reload} />}
      {!list.items && list.loading && <Loading />}
      {list.items && !list.items.length && <Empty>No {state === 'all' ? '' : `${state} `}{kind === 'pull' ? 'pull requests' : 'issues'}.</Empty>}
      <div className={p.list}>{(list.items || []).map((it) => <IssueRow key={it.id} item={it} showRepo={false} />)}</div>
      {list.hasMore && <More busy={list.loading} onClick={list.more} />}
    </div>
  );
}

function ReleasesTab({ full }) {
  const list = usePagedList(`/github/repo/${full}/releases`);
  return (
    <div>
      {list.error && <Failed message={list.error} onRetry={list.reload} />}
      {!list.items && list.loading && <Loading />}
      {list.items && !list.items.length && <Empty>No releases published.</Empty>}
      <ol className={p.releases}>
        {(list.items || []).map((r, i) => <Release key={r.id} r={r} open={i === 0} />)}
      </ol>
      {list.hasMore && <More busy={list.loading} onClick={list.more}>Older releases</More>}
    </div>
  );
}

function Release({ r, open: initial }) {
  const [open, setOpen] = useState(initial);
  const x = r.extra;
  return (
    <li className={p.release}>
      <header className={p.relHead}>
        <TagLabel tag={x.tag} pre={x.prerelease} big />
        <span className={p.relTitle}>{r.title !== x.tag ? r.title : ''}</span>
        <time>{shortDate(r.published_at)}</time>
        {r.author && <Link to={userPath(r.author)} className={p.who}><Face src={r.thumbnail} login={r.author} size={18} />{r.author}</Link>}
        <button type="button" className={p.btnGhost} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Fold' : 'Notes'}</button>
        <SaveButton item={r} size={14} />
      </header>
      {open && x.notes_html && <GhHtml html={x.notes_html} className={p.relNotes} />}
      {open && x.assets?.length > 0 && (
        <ul className={p.assets}>
          {x.assets.map((a) => (
            <li key={a.name}>
              <a href={a.url} target="_blank" rel="noopener noreferrer"><Download size={13} /> {a.name}</a>
              <span>{bytes(a.size)}</span>
              <span>{compact(a.downloads)} downloads</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PeopleTab({ full }) {
  const res = useApi(`/github/repo/${full}/contributors`);
  const items = res.data?.items || [];
  const max = Math.max(1, ...items.map((c) => c.contributions));
  return (
    <div>
      {res.error && <Failed message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && <Loading />}
      <ol className={p.people}>
        {items.map((c, i) => (
          <li key={c.login}>
            <span className={p.peopleRank}>{i + 1}</span>
            <Link to={userPath(c.login)} className={p.who}><Face src={c.avatar} login={c.login} size={24} /><b>{c.login}</b></Link>
            <span className={p.peopleBar}><i style={{ '--w': `${(c.contributions / max) * 100}%` }} /></span>
            <span className={p.peopleN}>{c.contributions.toLocaleString()} commit{c.contributions === 1 ? '' : 's'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── the repository ───────────────────────────────────────────────────────────

export default function GithubRepo() {
  const { owner, repo: name } = useParams();
  const full = `${owner}/${name}`;
  const [tab] = useParamState('t', 'readme');
  const [, setParams] = useSearchParams();
  const res = useApi(`/github/repo/${full}`);
  const readme = useApi(`/github/repo/${full}/readme`, tab === 'readme');
  const part = useShared(`/github/repo/${full}/participation`, { maxAge: 3_600_000 });
  const data = res.data;
  const r = data?.repo;
  const x = r?.extra || {};

  // A tab starts clean: the code view's path or the issues' filter belong to the tab they were set in.
  const switchTab = (t) => setParams(t === 'readme' ? {} : { t }, { replace: true });

  if (res.error && !data) return <div className={p.page}><Failed message={res.error} onRetry={res.reload} /></div>;
  if (!data) return <div className={p.page}><Loading label={`Opening ${full}`} /></div>;

  const tabs = [
    ['readme', 'Readme', null],
    ['code', 'Code', Code2],
    ['commits', 'Commits', GitCommitHorizontal],
    ...(x.has_issues !== false ? [['issues', 'Issues', MessageSquare]] : []),
    ['pulls', 'Pull requests', GitBranch],
    ['releases', 'Releases', Tag],
    ['people', 'People', Users],
  ];

  return (
    <div className={p.page} style={{ '--lc': langColor(x.language) || 'var(--c-github)' }}>
      <header className={p.plate}>
        <div className={p.plateTop}>
          <Link to={userPath(owner)} className={p.plateFace}><Face src={r.thumbnail} login={owner} size={44} square={x.owner_type === 'Organization'} /></Link>
          <h1 className={p.plateName}>
            <Link to={userPath(owner)} className={p.plateOwner}>{owner}</Link>
            <span className={p.plateSlash}>/</span>
            <span className={p.plateRepo}>{name}</span>
          </h1>
          <span className={p.plateBadges}>
            {x.private && <span className={p.badge}><Lock size={11} /> private</span>}
            {x.archived && <span className={p.badge}>archived</span>}
            {x.fork && x.parent && <Link to={repoPath(x.parent)} className={p.badge}><GitFork size={11} /> fork of {x.parent}</Link>}
          </span>
        </div>
        {x.description && <p className={p.plateDesc}>{x.description}</p>}
        <div className={p.plateActs}>
          <StarButton full={full} starred={data.viewer?.starred} count={x.stars} compactCount={false} onChange={() => res.reload()} />
          <FollowHere sourceId={full} />
          <SaveButton item={r} label />
          <a className={p.btnGhost} href={r.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> GitHub</a>
          {x.homepage && <a className={p.btnGhost} href={x.homepage} target="_blank" rel="noopener noreferrer"><Globe size={13} /> {x.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
        </div>
        {x.topics?.length > 0 && (
          <div className={p.topics}>
            {x.topics.map((t) => <Link key={t} to={`/github?q=${encodeURIComponent(`topic:${t}`)}`} className={p.topic}>{t}</Link>)}
          </div>
        )}
        <LangBar languages={data.languages} />
      </header>

      <Tabs tabs={tabs} value={tab} onChange={switchTab} />

      <div className={p.body}>
        <div className={p.content}>
          {tab === 'readme' && (
            readme.loading && !readme.data ? <Loading label="Reading the README" />
              : readme.error ? <Failed message={readme.error} onRetry={readme.reload} />
                : readme.data?.html ? <GhHtml html={readme.data.html} repo={full} dir="" className={p.readme} />
                  : <Empty action={<button type="button" className={p.btnGhost} onClick={() => switchTab('code')}>Browse the code</button>}>This repository has no README.</Empty>
          )}
          {tab === 'code' && <CodeTab full={full} data={data} />}
          {tab === 'commits' && <CommitsTab full={full} />}
          {tab === 'issues' && <ThreadsTab full={full} kind="issue" />}
          {tab === 'pulls' && <ThreadsTab full={full} kind="pull" />}
          {tab === 'releases' && <ReleasesTab full={full} />}
          {tab === 'people' && <PeopleTab full={full} />}
        </div>
        <aside className={p.facts}>
          <section className={p.fact}>
            <dl className={p.numbers}>
              <div><dt><Star size={13} /> Stars</dt><dd>{(x.stars ?? 0).toLocaleString()}</dd></div>
              <div><dt><GitFork size={13} /> Forks</dt><dd>{(x.forks ?? 0).toLocaleString()}</dd></div>
              {x.watchers != null && <div><dt>Watching</dt><dd>{x.watchers.toLocaleString()}</dd></div>}
              <div><dt>Open issues & PRs</dt><dd>{(x.open_issues ?? 0).toLocaleString()}</dd></div>
            </dl>
          </section>
          <section className={p.fact}>
            <dl className={p.facts2}>
              {x.license && <div><dt><Scale size={13} /> Licence</dt><dd>{x.license}</dd></div>}
              {x.default_branch && <div><dt><GitBranch size={13} /> Branch</dt><dd><code>{x.default_branch}</code></dd></div>}
              {x.pushed_at ? <div><dt>Last push</dt><dd>{timeAgo(x.pushed_at)} ago</dd></div> : null}
              {x.created_at ? <div><dt>Created</dt><dd>{shortDate(x.created_at)}</dd></div> : null}
              {x.size ? <div><dt>Size</dt><dd>{bytes(x.size * 1024)}</dd></div> : null}
            </dl>
            {part.data?.all && <Ridge weeks={part.data.all} />}
          </section>
          <LocalPanel full={full} data={data} onChanged={res.reload} />
        </aside>
      </div>
    </div>
  );
}

// ── a thread ─────────────────────────────────────────────────────────────────

const ASSOC = { OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor', FIRST_TIME_CONTRIBUTOR: 'First-time contributor' };
const REVIEW = { approved: 'approved these changes', changes_requested: 'asked for changes', commented: 'reviewed', dismissed: 'review dismissed' };

function Entry({ c, kind = 'comment', state }) {
  return (
    <li className={p.entryC} data-node={state === 'approved' ? 'ok' : state === 'changes_requested' ? 'warn' : kind}>
      <header className={p.entryHead}>
        <Link to={userPath(c.author)} className={p.who}><Face src={c.avatar} login={c.author} size={22} /><b>{c.author}</b></Link>
        {state && <span className={`${p.review} ${p[`rv_${state}`] || ''}`}>{REVIEW[state] || state}</span>}
        {ASSOC[c.association] && <span className={p.assoc}>{ASSOC[c.association]}</span>}
        <a href={c.url} target="_blank" rel="noopener noreferrer" className={p.dim}>{timeAgo(c.created_at)} ago</a>
        {c.updated_at - c.created_at > 60 && <span className={p.dim}>edited</span>}
      </header>
      {c.html && <GhHtml html={c.html} className={p.entryBody} />}
    </li>
  );
}

function Composer({ full, number, onPosted }) {
  const key = `tubcal.gh.draft.${full}#${number}`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { try { if (text) localStorage.setItem(key, text); else localStorage.removeItem(key); } catch { /* private window */ } }, [key, text]);
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const c = await api(`/github/repo/${full}/thread/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) });
      setText('');
      onPosted(c);
      toast('Comment posted', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={p.composer}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); post(); } }}
        placeholder="Add a comment (Markdown works; Ctrl+Enter posts)"
        rows={5}
        aria-label="Your comment"
      />
      <div className={p.composerActs}>
        <span className={p.dim}>Posts to GitHub as you. The draft is kept here until it’s posted.</span>
        <button type="button" className={p.btnSolid} onClick={post} disabled={!text.trim() || busy}>{busy ? 'Posting…' : 'Comment'}</button>
      </div>
    </div>
  );
}

function Checks({ checks }) {
  if (!checks?.length) return null;
  const done = checks.filter((c) => c.status === 'completed');
  const bad = done.filter((c) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion));
  const running = checks.length - done.length;
  const tone = bad.length ? p.warn : running ? p.dim : p.ok;
  return (
    <details className={p.checks}>
      <summary className={tone}>
        {bad.length ? `${bad.length} of ${checks.length} checks failed` : running ? `${running} of ${checks.length} checks running` : `All ${checks.length} checks passed`}
      </summary>
      <ul>
        {checks.map((c) => (
          <li key={`${c.name}-${c.url}`}>
            <a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a>
            <span className={['failure', 'timed_out', 'cancelled'].includes(c.conclusion) ? p.warn : c.conclusion === 'success' ? p.ok : p.dim}>
              {c.status === 'completed' ? c.conclusion : c.status.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function GithubThread({ kind: routeKind }) {
  const { owner, repo: name, number } = useParams();
  const full = `${owner}/${name}`;
  const [page, setPage] = useState(0);
  const [extra, setExtra] = useState([]);
  const [tab, setTab] = useParamState('tab', 'talk');
  const res = useApi(`/github/repo/${full}/thread/${number}`);
  const more = useApi(`/github/repo/${full}/thread/${number}?page=${page}`, page > 0);
  const { linked, can } = useGhAccount();
  const navigate = useNavigate();
  const d = res.data;
  const item = d?.item;
  const x = item?.extra || {};
  const isPull = x.kind === 'pull';
  const files = useApi(`/github/repo/${full}/pull/${number}/files`, isPull && tab === 'files');
  useEffect(() => { if (more.data) setExtra((e) => [...e, ...more.data.comments]); }, [more.data]);
  useEffect(() => { setExtra([]); setPage(0); }, [full, number]);

  // A pull request opened as an issue (or the other way round) moves to its own address.
  useEffect(() => {
    if (item && routeKind && x.kind !== routeKind) navigate(threadPath(full, x.kind, number), { replace: true });
  }, [item, routeKind, x.kind, full, number, navigate]);

  const timeline = useMemo(() => {
    if (!d) return [];
    const list = [
      ...[...d.comments, ...extra].map((c) => ({ ...c, t: c.created_at, type: 'comment' })),
      ...(d.reviews || []).filter((r) => r.html || r.state !== 'commented').map((r) => ({ ...r, t: r.created_at, type: 'review' })),
    ];
    return list.sort((a, b) => a.t - b.t);
  }, [d, extra]);

  if (res.error && !d) return <div className={p.page}><Failed message={res.error} onRetry={res.reload} /></div>;
  if (!d) return <div className={p.page}><Loading label={`Opening #${number}`} /></div>;

  const participants = [...new Map([[item.author, item.thumbnail], ...timeline.map((c) => [c.author, c.avatar])]).entries()].filter(([a]) => a);
  const posted = (c) => setExtra((e) => [...e, c]);

  return (
    <div className={p.page}>
      <header className={p.threadHead}>
        <Link to={repoPath(full, { t: isPull ? 'pulls' : 'issues' })} className={p.threadRepo}><RepoName full={full} /></Link>
        <h1 className={p.threadTitle}>{item.title} <span className={p.threadNum}>#{x.number}</span></h1>
        <div className={p.threadMeta}>
          <StatePill kind={x.kind} state={x.state} reason={x.state_reason} draft={x.draft} />
          <span>
            <Link to={userPath(item.author)}>{item.author}</Link> opened this {timeAgo(x.created_at)} ago
            {x.comments ? `, ${x.comments} comment${x.comments === 1 ? '' : 's'}` : ''}
          </span>
          {x.labels?.map((l) => <Label key={l.name} {...l} />)}
          <SaveButton item={item} label />
          <a className={p.btnGhost} href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> GitHub</a>
        </div>
        {isPull && d.pull && (
          <div className={p.prLine}>
            <code>{d.pull.head}</code> <span className={p.dim}>into</span> <code>{d.pull.base}</code>
            <DiffStat add={d.pull.additions || 0} del={d.pull.deletions || 0} />
            <span className={p.dim}>{d.pull.commits} commit{d.pull.commits === 1 ? '' : 's'}, {d.pull.changed_files} file{d.pull.changed_files === 1 ? '' : 's'}</span>
            {d.pull.merged_by && <span className={p.dim}>merged by <Link to={userPath(d.pull.merged_by)}>{d.pull.merged_by}</Link></span>}
            <Checks checks={d.checks} />
          </div>
        )}
      </header>
      {isPull && (
        <Tabs tabs={[['talk', 'Conversation', MessageSquare, timeline.length + 1], ['files', 'Files changed', FileCode, d.pull?.changed_files]]} value={tab} onChange={setTab} />
      )}
      <div className={p.body}>
        <div className={p.content}>
          {tab === 'files' && isPull ? (
            files.loading && !files.data ? <Loading label="Reading the changes" />
              : files.error ? <Failed message={files.error} onRetry={files.reload} />
                : files.data ? <DiffView files={files.data.files} repo={full} refName={d.pull?.head_sha} /> : null
          ) : (
            <>
              <ol className={p.talk}>
                <Entry c={{ author: item.author, avatar: item.thumbnail, association: x.association, created_at: x.created_at, updated_at: x.created_at, html: d.body_html || '<p><em>No description.</em></p>', url: item.url }} kind="body" />
                {timeline.map((c) => (
                  <Entry key={`${c.type}-${c.id}`} c={c} kind={c.type} state={c.type === 'review' ? c.state : undefined} />
                ))}
              </ol>
              {(more.data ? more.data.more_comments : d.more_comments) && (
                <More busy={more.loading} onClick={() => setPage((n) => n + 1)}>More comments</More>
              )}
              {d.locked ? (
                <p className={p.dim}>This conversation is locked.</p>
              ) : linked && can.comment ? (
                <Composer full={full} number={number} onPosted={posted} />
              ) : (
                <p className={p.dim}>{linked ? 'The linked token can’t post comments.' : 'Link a GitHub account (Settings → Accounts) to comment from here.'}</p>
              )}
            </>
          )}
        </div>
        <aside className={p.facts}>
          {x.assignees?.length > 0 && (
            <section className={p.fact}>
              <h4>Assigned</h4>
              {x.assignees.map((a) => <Link key={a.login} to={userPath(a.login)} className={p.who}><Face src={a.avatar} login={a.login} size={20} />{a.login}</Link>)}
            </section>
          )}
          {d.pull?.reviewers?.length > 0 && (
            <section className={p.fact}>
              <h4>Review requested from</h4>
              {d.pull.reviewers.map((a) => <Link key={a.login} to={userPath(a.login)} className={p.who}><Face src={a.avatar} login={a.login} size={20} />{a.login}</Link>)}
            </section>
          )}
          {x.milestone && <section className={p.fact}><h4>Milestone</h4><p>{x.milestone}</p></section>}
          <section className={p.fact}>
            <h4>{participants.length} {participants.length === 1 ? 'person' : 'people'} in this</h4>
            <div className={p.faces}>
              {participants.map(([login, avatar]) => <Link key={login} to={userPath(login)} title={login}><Face src={avatar} login={login} size={26} /></Link>)}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ── a commit ─────────────────────────────────────────────────────────────────

export function GithubCommit() {
  const { owner, repo: name, sha } = useParams();
  const full = `${owner}/${name}`;
  const res = useApi(`/github/repo/${full}/commit/${sha}`);
  const toast = useToast();
  const c = res.data;
  if (res.error && !c) return <div className={p.page}><Failed message={res.error} onRetry={res.reload} /></div>;
  if (!c) return <div className={p.page}><Loading label={`Opening ${sha.slice(0, 7)}`} /></div>;
  const x = c.extra;
  const copy = async () => {
    try { await navigator.clipboard.writeText(x.sha); toast('Hash copied', 'success'); } catch { toast(x.sha, 'info'); }
  };
  return (
    <div className={p.page}>
      <header className={p.threadHead}>
        <Link to={repoPath(full, { t: 'commits' })} className={p.threadRepo}><RepoName full={full} /></Link>
        <h1 className={p.threadTitle}>{c.title}</h1>
        {x.body && <pre className={p.commitBody}>{x.body}</pre>}
        <div className={p.threadMeta}>
          {c.author && <Link to={userPath(c.author)} className={p.who}><Face src={c.thumbnail} login={c.author} size={22} /><b>{c.author}</b></Link>}
          {x.name && x.name !== c.author && <span className={p.dim}>{x.name}</span>}
          <span className={p.dim}>{timeAgo(c.published_at)} ago</span>
          {x.verified && <span className={`${p.ok} ${p.inline}`}><ShieldCheck size={13} /> verified</span>}
          <DiffStat add={x.additions || 0} del={x.deletions || 0} />
          <SaveButton item={c} label />
          <a className={p.btnGhost} href={c.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> GitHub</a>
        </div>
        <div className={p.shaLine}>
          <code>{x.sha}</code>
          <button type="button" onClick={copy} aria-label="Copy the hash"><Copy size={13} /></button>
          {x.parent_shas?.length > 0 && (
            <span className={p.dim}>
              {x.parent_shas.length > 1 ? 'parents' : 'parent'}{' '}
              {x.parent_shas.map((ps) => <Hash key={ps} repo={full} sha={ps} />)}
            </span>
          )}
          <Link className={p.btnGhost} to={codePath(full, '', x.sha)}><Folder size={13} /> Browse at this commit</Link>
        </div>
      </header>
      {x.files?.length ? <DiffView files={x.files} repo={full} refName={x.sha} /> : <Empty>No file changes.</Empty>}
    </div>
  );
}
