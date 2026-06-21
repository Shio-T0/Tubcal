import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, ThumbsUp, X } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import CommentThread from '../modals/CommentThread.jsx';
import { Spinner } from '../ui/index.jsx';
import s from './player.module.css';

const DESC_CLAMP = 400;

function Description({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > DESC_CLAMP;
  const shown = open || !long ? text : `${text.slice(0, DESC_CLAMP).trimEnd()}…`;
  return (
    <div className={s.panelDesc}>
      {shown}
      {long && (
        <button className={s.panelMore} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// A free-floating card pinned to the left edge of the screen (detached from the
// centered video) holding the focused video's description + top comments. Both
// are fetched here so the panel is fully self-contained.
export default function PlayerSidePanel({ item, onClose }) {
  const vid = item.extra?.video_id;
  const channelId = item.extra?.channel_id;
  const meta = useApi(vid ? `/youtube/video/${vid}` : '', !!vid);
  const comments = useApi(vid ? `/youtube/comments/${vid}` : '', !!vid);
  const info = meta.data;
  const list = comments.data?.comments || [];

  return (
    <aside className={s.floatPanel}>
      <div className={s.panelHead}>
        <div className={s.panelHeadText}>
          <span className={s.panelHeadTitle}>{item.title}</span>
          {channelId ? (
            <Link className={s.panelHeadChannel} to={`/youtube/c/${channelId}`}>
              {item.source}
            </Link>
          ) : (
            <span className={s.panelHeadChannel}>{item.source}</span>
          )}
        </div>
        <button className={s.btn} title="Hide panel" onClick={onClose} aria-label="Hide panel">
          <X size={15} />
        </button>
      </div>

      <div className={s.panelScroll}>
        {info && (info.view_count != null || info.like_count != null) && (
          <div className={s.panelStats}>
            {info.view_count != null && (
              <span>
                <Eye size={12} /> {compact(info.view_count)}
                {info.live_status === 'is_live' ? ' watching' : ' views'}
              </span>
            )}
            {info.like_count != null && (
              <span>
                <ThumbsUp size={12} /> {compact(info.like_count)}
              </span>
            )}
          </div>
        )}

        {info?.description ? (
          <>
            <div className={s.panelLabel}>Description</div>
            <Description text={info.description} />
          </>
        ) : null}

        <div className={s.panelLabel}>Comments</div>
        {comments.loading && (
          <div className={s.panelCenter}>
            <Spinner />
          </div>
        )}
        {comments.error && <p className={s.panelEmpty}>Comments unavailable right now.</p>}
        {!comments.loading && !comments.error && list.length === 0 && (
          <p className={s.panelEmpty}>No comments to show.</p>
        )}
        {list.length > 0 && <CommentThread comments={list} />}
      </div>
    </aside>
  );
}
