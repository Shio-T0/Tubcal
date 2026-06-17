import { useState } from 'react';

import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import SafeHtml from './SafeHtml.jsx';
import m from './Modal.module.css';
import s from './comments.module.css';

function CommentNode({ comment }) {
  const [collapsed, setCollapsed] = useState(false);
  const rail = `var(--rail-${comment.depth % 5})`;

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
          <span className={s.commentAuthor}>{comment.author}</span>
          {comment.score !== null && comment.score !== undefined && (
            <span className={s.commentScore}>{compact(comment.score)}</span>
          )}
          <time>{timeAgo(comment.created_at)}</time>
        </div>
        {collapsed ? (
          <span className={s.collapsedNote} onClick={() => setCollapsed(false)}>
            [+] {1 + countDescendants(comment)} hidden
          </span>
        ) : (
          <>
            <SafeHtml html={comment.body_html} className={m.richText} />
            {comment.children.length > 0 && (
              <div className={`${s.thread} ${s.children}`}>
                {comment.children.map((c) => (
                  <CommentNode key={c.id} comment={c} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function countDescendants(comment) {
  return comment.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

export default function CommentThread({ comments }) {
  if (!comments?.length) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No comments yet.</p>;
  }
  return (
    <div className={s.thread}>
      {comments.map((c) => (
        <CommentNode key={c.id} comment={c} />
      ))}
    </div>
  );
}
