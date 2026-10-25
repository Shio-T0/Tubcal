// A GitHub repository as a slide-in page (the GitHub room's part of the phone app,
// in its split APK): description, numbers, topics, releases and README.
// discuss.jsx's opener loads it when this phone has the room.

import { ExternalLink, GitFork, Share2, Star, Tag } from 'lucide-react';

import { useApi } from '@pc/api/client.js';
import SafeHtml from '@pc/components/modals/SafeHtml.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';

import { openExternal, share } from '../lib/bridge.js';
import { ErrorNote, IconBtn, Loading, Overlay } from '../shell/Shell.jsx';
import { SaveIcon } from './discuss.jsx';
import d from './discuss.module.css';

/** A GitHub repository: description, numbers, topics, releases, README. */
export function RepoPage({ item, onClose }) {
  const fullName = item?.extra?.repo || item?.source || null;
  const res = useApi(fullName ? `/github/item/${fullName}` : '', !!fullName);
  if (!item) return null;
  const data = res.data;
  const repo = data?.story || item;
  const x = repo.extra || item.extra || {};
  const url = `https://github.com/${fullName}`;
  return (
    <Overlay
      open
      onClose={onClose}
      title={fullName}
      sub={repo.author || 'repository'}
      tone="var(--c-github)"
      actions={
        <>
          <SaveIcon item={item} />
          <IconBtn label="Share" onClick={() => share({ title: fullName, url })}><Share2 size={20} /></IconBtn>
        </>
      }
    >
      <article className={d.post} data-reveal="fade">
        {repo.title && repo.title !== fullName && <h2 className={d.title}>{repo.title}</h2>}
        {x.description && <p className={d.desc}>{x.description}</p>}
        <div className={d.stats}>
          {x.stars != null && <span><Star size={14} /> {compact(x.stars)}</span>}
          {x.forks != null && <span><GitFork size={14} /> {compact(x.forks)}</span>}
          {x.language && <span><Tag size={14} /> {x.language}</span>}
          <button type="button" onClick={() => openExternal(url)}>GitHub <ExternalLink size={13} /></button>
        </div>
        {x.topics?.length > 0 && (
          <div className={d.topics}>{x.topics.slice(0, 14).map((t) => <span key={t}>{t}</span>)}</div>
        )}
      </article>
      {res.loading && !data && <Loading label="cloning the details" />}
      {res.error && <ErrorNote message={res.error} onRetry={res.reload} />}
      {data?.releases?.length > 0 && (
        <section className={d.thread}>
          <h3 className={d.threadHead}>Releases</h3>
          {data.releases.map((r) => (
            <button key={r.id} type="button" className={d.release} onClick={() => openExternal(r.url)} data-reveal="side">
              <b>{r.title}</b>
              <span>{r.extra?.tag} · {ago(r.published_at)}{r.extra?.prerelease ? ' · pre-release' : ''}</span>
            </button>
          ))}
        </section>
      )}
      {data?.readme_html && (
        <section className={d.thread}>
          <h3 className={d.threadHead}>README</h3>
          <SafeHtml html={data.readme_html} className={d.rich} />
        </section>
      )}
    </Overlay>
  );
}

export default RepoPage;
