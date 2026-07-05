import { ExternalLink, GitFork, Star, Tag } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { Spinner } from '../ui/index.jsx';
import Modal from './Modal.jsx';
import SafeHtml from './SafeHtml.jsx';
import s from './Modal.module.css';

/** In-app GitHub repo view — mirrors RedditPostModal's pattern: fetch full
 * detail on open, render inline, keep the real github.com link as a
 * secondary action rather than the only way to see the repo. */
export default function RepoDetailModal({ item, onClose }) {
  const fullName = item?.extra?.repo || item?.source || null;
  const { data, loading, error } = useApi(
    fullName ? `/github/item/${fullName}` : '',
    !!fullName,
  );

  if (!item) return null;
  const repo = data?.story || item;
  const extra = repo.extra || item.extra || {};

  return (
    <Modal open={!!item} onClose={onClose} label={repo.title || fullName} maxWidth={780}>
      <div className={s.modalBody}>
        <div className={s.modalMeta} style={{ color: 'var(--c-github)' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{fullName}</span>
          {repo.author && <span style={{ color: 'var(--text-muted)' }}>{repo.author}</span>}
        </div>
        <h2 className={s.modalTitle}>{repo.title || fullName}</h2>

        {extra.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            {extra.description}
          </p>
        )}

        <div className={s.modalMeta}>
          {extra.stars != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Star size={13} /> {compact(extra.stars)}
            </span>
          )}
          {extra.forks != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <GitFork size={13} /> {compact(extra.forks)}
            </span>
          )}
          {extra.language && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Tag size={13} /> {extra.language}
            </span>
          )}
          <a className={s.externalLink} href={`https://github.com/${fullName}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            Open on GitHub
          </a>
        </div>

        {extra.topics?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {extra.topics.slice(0, 12).map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'var(--surface-glass-hover)',
                  color: 'var(--c-github)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {loading && (
          <div className={s.centered}>
            <Spinner />
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        {data?.releases?.length > 0 && (
          <>
            <div className={s.sectionLabel}>Releases</div>
            {data.releases.map((r) => (
              <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-glass)' }}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600, fontSize: 14 }}
                >
                  {r.title}
                </a>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {r.extra?.tag} · {timeAgo(r.published_at)}
                  {r.extra?.prerelease && ' · pre-release'}
                </div>
              </div>
            ))}
          </>
        )}

        {data?.readme_html && (
          <>
            <div className={s.sectionLabel}>README</div>
            <SafeHtml html={data.readme_html} className={s.richText} />
          </>
        )}
      </div>
    </Modal>
  );
}
