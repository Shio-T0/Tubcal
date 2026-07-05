import { useState } from 'react';
import { ChevronDown, MessageSquare, Pin } from 'lucide-react';

import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import SafeHtml from './SafeHtml.jsx';
import m from './Modal.module.css';
import s from './comments.module.css';

function countList(list) {
  return list.reduce((acc, c) => acc + 1 + countList(c.children || []), 0);
}

/** A single comment. When `loadReplies` is provided (the YouTube panel), comments
 *  with replies expand their nested thread on demand via a continuation token;
 *  without it (Reddit/HN, where the whole tree arrives at once) it just renders
 *  the pre-loaded `children`. */
function CommentNode({ comment, loadReplies }) {
  const [collapsed, setCollapsed] = useState(false);
  const [kids, setKids] = useState(comment.children || []);
  const [token, setToken] = useState(comment.reply_token || null);
  const [open, setOpen] = useState((comment.children || []).length > 0);
  const [loading, setLoading] = useState(false);
  const rail = `var(--rail-${comment.depth % 5})`;

  const lazy = !!loadReplies && (comment.reply_count || 0) > 0;
  const remaining = (comment.reply_count || 0) - kids.length;

  const fetchReplies = async () => {
    if (!token || loading) return;
    setLoading(true);
    try {
      const res = await loadReplies(token, (comment.depth ?? 0) + 1);
      setKids((k) => [...k, ...(res.comments || [])]);
      setToken(res.continuation || null);
      setOpen(true);
    } catch {
      /* leave the toggle so the user can retry */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={s.comment}>
      <div
        className={s.rail}
        style={{ '--rail-c': rail }}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand' : 'Collapse'}
      />
      <div className={s.commentMain}>
        <div className={s.commentHead}>
          {comment.is_pinned && (
            <span className={s.pinned} title="Pinned by creator"><Pin size={10} /> Pinned</span>
          )}
          <span className={s.commentAuthor}>{comment.author}</span>
          {comment.score !== null && comment.score !== undefined && (
            <span className={s.commentScore}>{compact(comment.score)}</span>
          )}
          <time>{timeAgo(comment.created_at)}</time>
        </div>
        {collapsed ? (
          <span className={s.collapsedNote} onClick={() => setCollapsed(false)}>
            [+] {1 + countList(kids)} hidden
          </span>
        ) : (
          <>
            <SafeHtml html={comment.body_html} className={m.richText} />

            {/* lazy: a comment with replies not yet shown */}
            {lazy && !open && (
              <button className={s.repliesToggle} onClick={fetchReplies} disabled={loading}>
                <ChevronDown size={13} className={loading ? s.spin : ''} />
                {loading
                  ? 'Loading replies…'
                  : `View ${comment.reply_count} ${comment.reply_count === 1 ? 'reply' : 'replies'}`}
              </button>
            )}

            {kids.length > 0 && (
              <div className={`${s.thread} ${s.children}`}>
                {kids.map((c) => (
                  <CommentNode key={c.id} comment={c} loadReplies={loadReplies} />
                ))}
              </div>
            )}

            {/* lazy: more pages of replies at this level */}
            {lazy && open && token && (
              <button className={s.repliesToggle} onClick={fetchReplies} disabled={loading}>
                <MessageSquare size={12} />
                {loading ? 'Loading…' : remaining > 0 ? `Show ${remaining} more` : 'Show more replies'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CommentThread({ comments, loadReplies }) {
  if (!comments?.length) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No comments yet.</p>;
  }
  return (
    <div className={s.thread}>
      {comments.map((c) => (
        <CommentNode key={c.id} comment={c} loadReplies={loadReplies} />
      ))}
    </div>
  );
}
