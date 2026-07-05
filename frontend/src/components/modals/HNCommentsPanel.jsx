import { ExternalLink, TrendingUp } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { Spinner } from '../ui/index.jsx';
import CommentThread from './CommentThread.jsx';
import Modal from './Modal.jsx';
import s from './Modal.module.css';

export default function HNCommentsPanel({ item, onClose }) {
  const { data, loading, error } = useApi(
    item ? `/hackernews/item/${item.extra.hn_id}` : '',
    !!item,
  );

  if (!item) return null;
  const story = data?.story || item;

  return (
    <Modal open={!!item} onClose={onClose} label={item.title} maxWidth={780}>
      <div className={s.modalBody}>
        <div className={s.modalMeta} style={{ color: 'var(--c-hn)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}>
            <TrendingUp size={13} /> {compact(story.score) ?? '–'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{story.author}</span>
          <time style={{ color: 'var(--text-muted)' }}>{timeAgo(story.published_at)}</time>
        </div>
        <h2 className={s.modalTitle}>{item.title}</h2>
        <div className={s.modalMeta}>
          <a className={s.externalLink} href={item.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            {item.extra.domain || 'news.ycombinator.com'}
          </a>
          <a
            className={s.externalLink}
            href={`https://news.ycombinator.com/item?id=${item.extra.hn_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on HN
          </a>
        </div>

        <div className={s.sectionLabel}>Comments</div>
        {loading && (
          <div className={s.centered}>
            <Spinner />
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {data && <CommentThread comments={data.comments} />}
      </div>
    </Modal>
  );
}
