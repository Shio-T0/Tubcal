import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { timeAgo } from '../../lib/time.js';
import Modal from './Modal.jsx';
import s from './Modal.module.css';

export default function VideoModal({ item, onClose, onMinimize }) {
  if (!item) return null;
  const channelId = item.extra?.channel_id;
  return (
    <Modal open={!!item} onClose={onClose} onMinimize={onMinimize} label={item.title} maxWidth={960}>
      <iframe
        className={s.videoFrame}
        src={`https://www.youtube-nocookie.com/embed/${item.extra.video_id}?autoplay=1&rel=0`}
        title={item.title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      <div className={s.modalBody}>
        <h2 className={s.modalTitle}>{item.title}</h2>
        <div className={s.modalMeta}>
          {channelId ? (
            <Link className={s.channelLink} to={`/youtube/c/${channelId}`} onClick={onClose}>
              {item.source}
            </Link>
          ) : (
            <span>{item.source}</span>
          )}
          <span>·</span>
          <time>{timeAgo(item.published_at)}</time>
          <a className={s.externalLink} href={item.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            Open on YouTube
          </a>
        </div>
      </div>
    </Modal>
  );
}
