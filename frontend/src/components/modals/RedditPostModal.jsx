import { ArrowUpRight, ExternalLink, MessageCircle, TrendingUp } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { Spinner } from '../ui/index.jsx';
import CommentThread from './CommentThread.jsx';
import Modal from './Modal.jsx';
import SafeHtml from './SafeHtml.jsx';
import s from './Modal.module.css';

export default function RedditPostModal({ item, onClose }) {
  const { data, loading, error } = useApi(
    item ? `/reddit/post/${item.extra.subreddit}/${item.extra.post_id}` : '',
    !!item,
  );

  if (!item) return null;
  const post = data?.post || item;
  const showImage = item.thumbnail && !item.extra.is_self;

  return (
    <Modal open={!!item} onClose={onClose} label={item.title} maxWidth={780}>
      <div className={s.modalBody}>
        <div className={s.modalMeta} style={{ color: 'var(--c-reddit)' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.source}</span>
          <span style={{ color: 'var(--text-muted)' }}>{item.author}</span>
          <time style={{ color: 'var(--text-muted)' }}>{timeAgo(item.published_at)}</time>
        </div>
        <h2 className={s.modalTitle}>{item.title}</h2>

        <div className={s.modalMeta}>
          {post.score !== null && post.score !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <TrendingUp size={13} /> {compact(post.score)}
            </span>
          )}
          {post.comments_count !== null && post.comments_count !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <MessageCircle size={13} /> {compact(post.comments_count)}
            </span>
          )}
          <a className={s.externalLink} href={item.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            Open on Reddit
          </a>
        </div>

        {showImage && <img className={s.postImage} src={item.thumbnail} alt="" />}
        {item.extra.link_url && (
          <a
            className={s.externalLink}
            href={item.extra.link_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ArrowUpRight size={13} />
            {item.extra.link_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)}
          </a>
        )}
        {data?.selftext_html && <SafeHtml html={data.selftext_html} className={s.richText} />}

        <div className={s.sectionLabel}>Comments</div>
        {data?.limited && (
          <div className={s.limitedNote}>
            Reddit limits anonymous access, so comments appear flattened without scores. Connect
            your Reddit account in Settings for full threads.
          </div>
        )}
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
