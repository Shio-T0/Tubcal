// A person or an organisation on GitHub: who they are, a year of their
// contributions, and their repositories (recently pushed, or by stars). Follow
// them here (their public activity joins the graph) or, with a linked account,
// on GitHub itself.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Building2, ExternalLink, Link2, MapPin, UserCheck, UserPlus } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { Empty, Face, Failed, FollowHere, Loading, More } from '../components/github/bits.jsx';
import Calendar from '../components/github/Calendar.jsx';
import { RepoRow } from '../components/github/Rows.jsx';
import { shortDate, useGhAccount } from '../lib/gh.js';
import { useParamState } from '../lib/urlState.js';
import { useToast } from '../state.jsx';
import p from './ghpages.module.css';

function FollowOnGithub({ login, following, onChange }) {
  const { linked, can } = useGhAccount();
  const toast = useToast();
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(following), [following]);
  if (!linked || on == null) return null;
  const able = can.follow;
  const click = async () => {
    setBusy(true);
    try {
      await api(`/github/user/${login}/follow`, { method: on ? 'DELETE' : 'PUT' });
      setOn(!on);
      onChange?.();
      toast(on ? `Unfollowed ${login} on GitHub` : `Following ${login} on GitHub`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={on ? p.btnSolid : p.btnGhost} onClick={click} disabled={!able || busy}
      title={able ? (on ? 'Unfollow on GitHub' : 'Follow on GitHub') : 'The linked token needs the user:follow scope'}>
      {on ? <UserCheck size={14} /> : <UserPlus size={14} />} {on ? 'Following on GitHub' : 'Follow on GitHub'}
    </button>
  );
}

export default function GithubUser() {
  const { login } = useParams();
  const [sort, setSort] = useParamState('sort', 'pushed');
  const res = useApi(`/github/user/${login}`);
  const cal = useApi(`/github/user/${login}/contributions`);
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const repos = useApi(`/github/user/${login}/repos?sort=${sort}&page=${page}`);
  useEffect(() => { setPages([]); setPage(0); }, [login, sort]);
  useEffect(() => { if (repos.data) setPages((x) => { const n = [...x]; n[page] = repos.data.items; return n; }); }, [repos.data, page]);
  const list = pages.flat().filter(Boolean);

  if (res.error && !res.data) return <div className={p.page}><Failed message={res.error} onRetry={res.reload} /></div>;
  if (!res.data) return <div className={p.page}><Loading label={`Opening ${login}`} /></div>;
  const u = res.data.user;
  const x = u.extra;
  const org = x.account_type === 'Organization';

  return (
    <div className={p.page}>
      <header className={p.person}>
        <Face src={u.thumbnail} login={x.login} size={112} square={org} />
        <div className={p.personText}>
          <h1>{x.name || x.login}</h1>
          {x.name && <p className={p.personLogin}>{x.login}{org ? ', an organisation' : ''}</p>}
          {x.bio && <p className={p.personBio}>{x.bio}</p>}
          <p className={p.personFacts}>
            {x.company && <span><Building2 size={13} /> {x.company}</span>}
            {x.location && <span><MapPin size={13} /> {x.location}</span>}
            {x.blog && <a href={/^https?:/.test(x.blog) ? x.blog : `https://${x.blog}`} target="_blank" rel="noopener noreferrer"><Link2 size={13} /> {x.blog.replace(/^https?:\/\//, '')}</a>}
            {x.created_at ? <span>on GitHub since {shortDate(x.created_at)}</span> : null}
          </p>
          <p className={p.personNums}>
            {!org && <span><b>{(x.followers ?? 0).toLocaleString()}</b> followers</span>}
            {!org && <span><b>{(x.following ?? 0).toLocaleString()}</b> following</span>}
            <span><b>{(x.public_repos ?? 0).toLocaleString()}</b> public repositories</span>
          </p>
          <div className={p.plateActs}>
            {!res.data.is_me && <FollowHere sourceId={x.login} />}
            {!res.data.is_me && <FollowOnGithub login={x.login} following={res.data.viewer?.following} />}
            <SaveButton item={u} label />
            <a className={p.btnGhost} href={u.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> GitHub</a>
            {res.data.is_me && <Link className={p.btnGhost} to="/github?v=work">Your work</Link>}
          </div>
        </div>
      </header>

      {!org && cal.data?.days?.length > 0 && (
        <section className={p.calBox}>
          <Calendar data={cal.data} />
        </section>
      )}

      <div className={p.subBar}>
        <h2 className={p.subTitle}>Repositories</h2>
        {[['pushed', 'Recently pushed'], ['stars', 'Most stars'], ['full_name', 'By name']].map(([v, l]) => (
          <button key={v} type="button" className={sort === v ? p.chipOn : p.chip} onClick={() => setSort(v)}>{l}</button>
        ))}
      </div>
      {repos.error && <Failed message={repos.error} onRetry={repos.reload} />}
      {!list.length && repos.loading && <Loading />}
      {repos.data && !list.length && !repos.loading && <Empty>No public repositories.</Empty>}
      <div className={p.list}>{list.map((it) => <RepoRow key={it.id} item={it} follow />)}</div>
      {repos.data?.has_more && <More busy={repos.loading} onClick={() => setPage((n) => n + 1)} />}
    </div>
  );
}
