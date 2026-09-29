// A forum thread, read like a conversation rather than a list of boxes.
//
// The opening post sits in its own card; the replies hang beneath it as a tree,
// each level joined to its parent by a thread line you can click to fold that
// branch away. The author of the thread is marked OP wherever they speak, you are
// marked "you", and your own comments can be taken back. Replying opens the same
// writing desk as everywhere else, with the post-to-be previewed as you type; a
// posted comment appears in place at once, rendered by AniList itself.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Bell, BellRing, ExternalLink, Eye, Heart, Link2, Lock, MessageSquare, Pin, Reply, Trash2,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { useToast } from '../../state.jsx';
import { Receiving } from '../layout/Section.jsx';
import { MarkdownComposer } from './Composer.jsx';
import { asPerson, UserLink } from './Person.jsx';
import { AniHtml } from './RichText.jsx';
import t from './thread.module.css';

const fullDate = (s) => (s ? new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function LikeButton({ id, type, liked, likes, label = false }) {
  const toast = useToast();
  const [on, setOn] = useState(!!liked);
  const [n, setN] = useState(likes || 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOn(!!liked); setN(likes || 0); }, [liked, likes]);
  const toggle = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(true);
    const was = on;
    setOn(!was); // optimistic; settled below if AniList says no
    setN((x) => x + (was ? -1 : 1));
    try {
      await api('/anime/like', { method: 'POST', body: JSON.stringify({ id, type }) });
    } catch (err) {
      setOn(was);
      setN((x) => x + (was ? 1 : -1));
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <button type="button" className={`${t.act} ${t.like} ${on ? t.likeOn : ''}`} onClick={toggle} disabled={busy}
            aria-pressed={on} title={on ? 'Unlike' : 'Like'}>
      <Heart size={13} fill={on ? 'currentColor' : 'none'} />
      {n > 0 ? compact(n) : label ? 'Like' : ''}
    </button>
  );
}

export function SubscribeButton({ threadId, initial }) {
  const toast = useToast();
  const [on, setOn] = useState(!!initial);
  useEffect(() => setOn(!!initial), [initial]);
  const flip = async () => {
    try {
      const res = await api(`/anime/thread/${threadId}/subscribe`, { method: 'POST', body: JSON.stringify({ subscribe: !on }) });
      setOn(res.subscribed);
      toast(res.subscribed ? 'Following this thread — replies land in your inbox' : 'Stopped following', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <button type="button" className={`${t.pill} ${on ? t.pillOn : ''}`} onClick={flip} aria-pressed={on}
            title="Replies to threads you follow arrive in your inbox">
      {on ? <BellRing size={13} /> : <Bell size={13} />} {on ? 'Following' : 'Follow'}
    </button>
  );
}

// ── the comment tree ──────────────────────────────────────────────────────────

const countTree = (list) => (list || []).reduce((n, cm) => n + 1 + countTree(cm.children), 0);

function insertReply(list, parentId, node) {
  return list.map((cm) => (cm.id === parentId
    ? { ...cm, children: [...(cm.children || []), node] }
    : { ...cm, children: insertReply(cm.children || [], parentId, node) }));
}
function removeNode(list, id) {
  return list.filter((cm) => cm.id !== id).map((cm) => ({ ...cm, children: removeNode(cm.children || [], id) }));
}

function Who({ user, ctx }) {
  const op = ctx.opId && user?.id === ctx.opId;
  const you = ctx.meId && user?.id === ctx.meId;
  return (
    <span className={t.who}>
      <UserLink user={user} showAvatar={false} className={t.whoName} />
      {op && <span className={t.op} title="Started this thread">OP</span>}
      {you && <span className={t.you}>you</span>}
    </span>
  );
}

function CommentNode({ cm, depth, ctx }) {
  const [folded, setFolded] = useState(false);
  const [replying, setReplying] = useState(false);
  const kids = cm.children || [];
  const hidden = countTree(kids) + 1;
  const mine = ctx.meId && cm.user?.id === ctx.meId;
  return (
    <div className={`${t.node} ${depth > 5 ? t.deep : ''} ${cm.fresh ? t.fresh : ''}`} id={`c${cm.id}`}>
      <div className={t.gutter}>
        <UserLink user={cm.user} size="sm" showName={false} />
        {!folded && (kids.length > 0 || replying) && (
          <button type="button" className={t.line} onClick={() => setFolded(true)}
                  aria-label={`Fold this branch (${hidden} comments)`} title="Fold this branch" />
        )}
      </div>
      <div className={t.main}>
        <header className={t.head}>
          <Who user={cm.user} ctx={ctx} />
          <span className={t.when} title={fullDate(cm.created_at)}>{timeAgo(cm.created_at)}</span>
          {folded && (
            <button type="button" className={t.unfold} onClick={() => setFolded(false)}>
              + {hidden} folded
            </button>
          )}
        </header>
        {!folded && (
          <>
            <AniHtml html={cm.comment} className={t.text} />
            <footer className={t.acts}>
              <LikeButton id={cm.id} type="THREAD_COMMENT" liked={cm.liked} likes={cm.likes} />
              {!ctx.locked && ctx.meId && (
                <button type="button" className={`${t.act} ${replying ? t.actOn : ''}`} onClick={() => setReplying((r) => !r)}>
                  <Reply size={13} /> Reply
                </button>
              )}
              <button type="button" className={t.act} title="Copy a link to this comment"
                      onClick={() => ctx.copyLink(cm.id)}>
                <Link2 size={13} />
              </button>
              {mine && (
                <button type="button" className={`${t.act} ${t.danger}`} title="Delete your comment"
                        onClick={() => ctx.onDelete(cm.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </footer>
            {replying && (
              <div className={t.replyDesk}>
                <MarkdownComposer
                  compact
                  autoFocus
                  previewAs="reply"
                  submitLabel="Reply"
                  placeholder={`Reply to ${cm.user?.name || 'this comment'}…`}
                  draftKey={`thread:${ctx.threadId}:${cm.id}`}
                  onCancel={() => setReplying(false)}
                  onSubmit={async (text) => {
                    const ok = await ctx.onReply(text, cm.id);
                    if (ok) setReplying(false);
                    return ok;
                  }}
                />
              </div>
            )}
            {kids.length > 0 && (
              <div className={t.children}>
                {kids.map((ch) => <CommentNode key={ch.id} cm={ch} depth={depth + 1} ctx={ctx} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── the thread ────────────────────────────────────────────────────────────────

/** One thread. `variant="pane"` sits beside the forum list; `"page"` is its own
 *  route. `onClose` (pane) shows a back arrow for narrow screens. */
/** A thread and its conversation. `composerFirst` puts the reply box above the
 *  comments (a place that's *for* replying, like the curtain call), instead of
 *  under a long conversation. */
export function ThreadView({ threadId, variant = 'page', onClose, composerFirst = false }) {
  const toast = useToast();
  const me = useApi('/anime/me');
  const first = useApi(`/anime/thread/${threadId}`);
  const [comments, setComments] = useState(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!first.data) return;
    setComments(first.data.comments || []);
    setHasNext(!!first.data.has_next);
    setPage(1);
  }, [first.data]);

  const th = first.data?.thread;
  const meUser = asPerson(me.data);

  const loadMore = async () => {
    setMore(true);
    try {
      const d = await api(`/anime/thread/${threadId}?page=${page + 1}`);
      setComments((prev) => {
        const seen = new Set((prev || []).map((x) => x.id));
        return [...(prev || []), ...(d.comments || []).filter((x) => !seen.has(x.id))];
      });
      setHasNext(!!d.has_next);
      setPage((p) => p + 1);
    } catch (e) {
      toast(e.message, 'error');
    }
    setMore(false);
  };

  const onReply = useCallback(async (text, parentId = null) => {
    try {
      const res = await api(`/anime/thread/${threadId}/comment`, {
        method: 'POST', body: JSON.stringify({ text, parent_id: parentId }),
      });
      const node = {
        id: res?.id ?? Date.now(), comment: res?.comment || `<p>${text.replace(/</g, '&lt;')}</p>`,
        created_at: res?.createdAt || Math.floor(Date.now() / 1000), likes: 0, liked: false,
        user: meUser || { name: 'you' }, children: [], fresh: true,
      };
      setComments((prev) => (parentId ? insertReply(prev || [], parentId, node) : [...(prev || []), node]));
      toast(parentId ? 'Reply posted' : 'Comment posted', 'success');
      if (!parentId) requestAnimationFrame(() => document.getElementById(`c${node.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }, [threadId, meUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDelete = useCallback(async (id) => {
    if (!window.confirm('Delete your comment from AniList? Replies to it go with it.')) return;
    try {
      await api(`/anime/thread/${threadId}/comment/${id}`, { method: 'DELETE' });
      setComments((prev) => removeNode(prev || [], id));
      toast('Comment deleted', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [threadId, toast]);

  const copyLink = useCallback((cid) => {
    const url = `https://anilist.co/forum/thread/${threadId}/comment/${cid}`;
    navigator.clipboard?.writeText(url).then(() => toast('Link copied', 'success'), () => toast(url, 'info'));
  }, [threadId, toast]);

  if (first.loading && !first.data) return <div className={t.loading}><Receiving label="opening the thread" /></div>;
  if (first.error || !th) return <p className={t.muted}>{first.error || "Couldn't open this thread."}</p>;

  const ctx = {
    threadId, opId: th.user?.id, meId: me.data?.id, locked: th.locked, onReply, onDelete, copyLink,
  };
  const total = th.replies ?? countTree(comments);
  const shown = countTree(comments);
  const desk = (
    <div className={t.bottomDesk} id={`reply-${threadId}`}>
      {th.locked ? (
        <p className={t.muted}><Lock size={12} /> This thread is locked — no new replies.</p>
      ) : me.data ? (
        <MarkdownComposer
          previewAs="comment"
          submitLabel="Comment"
          placeholder={shown ? 'Add to the conversation…' : 'Be the first to reply…'}
          draftKey={`thread:${threadId}`}
          onSubmit={(text) => onReply(text, null)}
        />
      ) : (
        <p className={t.muted}>Connect AniList in Settings to join the conversation.</p>
      )}
    </div>
  );

  return (
    <article className={`${t.thread} ${t[variant]}`}>
      <header className={t.top}>
        {onClose && (
          <button type="button" className={t.back} onClick={onClose} aria-label="Back to the list">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className={t.tags}>
          {th.sticky && <span className={t.tagPin}><Pin size={11} /> pinned</span>}
          {th.locked && <span className={t.tagLock}><Lock size={11} /> locked</span>}
          {th.media && (
            <Link to={`/anime/${th.media.id}`} className={t.mediaTag}>
              {th.media.cover && <img src={th.media.cover} alt="" />}
              <span>{th.media.title}</span>
            </Link>
          )}
          {(th.categories || []).map((c) => <span key={c.id} className={t.tag}>{c.name}</span>)}
        </div>
        <h1 className={t.title}>{th.title}</h1>
        <div className={t.meta}>
          <span><MessageSquare size={13} /> {compact(total || 0)} {total === 1 ? 'reply' : 'replies'}</span>
          <span><Eye size={13} /> {compact(th.views || 0)}</span>
          {th.reply_user && th.replied_at && (
            <span className={t.last}>
              last word from <UserLink user={th.reply_user} size="xs" /> {timeAgo(th.replied_at)} ago
            </span>
          )}
        </div>
      </header>

      <section className={t.opPost}>
        <div className={t.opHead}>
          <UserLink user={th.user} size="md" className={t.opName} />
          <span className={t.opBadge}>started this thread</span>
          <span className={t.when} title={fullDate(th.created_at)}>{timeAgo(th.created_at)}</span>
        </div>
        {th.body ? <AniHtml html={th.body} className={t.body} /> : <p className={t.muted}>(no text)</p>}
        <footer className={t.opActs}>
          <LikeButton id={th.id} type="THREAD" liked={th.liked} likes={th.likes} label />
          {me.data && <SubscribeButton threadId={th.id} initial={th.subscribed} />}
          {!th.locked && me.data && (
            <a href="#reply" className={t.pill} onClick={(e) => {
              e.preventDefault();
              document.getElementById(`reply-${threadId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              document.querySelector(`#reply-${threadId} textarea`)?.focus({ preventScroll: true });
            }}>
              <Reply size={13} /> Reply
            </a>
          )}
          {th.site_url && (
            <a href={th.site_url} target="_blank" rel="noreferrer" className={t.pillQuiet}>
              AniList <ExternalLink size={11} />
            </a>
          )}
        </footer>
      </section>

      {composerFirst && desk}
      <div className={t.convoHead}>
        <span>{shown > 0 ? 'The conversation' : 'No replies yet'}</span>
        {shown > 0 && total > shown && <span className={t.convoCount}>showing {shown} of {total}</span>}
      </div>
      {comments && comments.length > 0 && (
        <div className={t.tree}>
          {comments.map((cm) => <CommentNode key={cm.id} cm={cm} depth={0} ctx={ctx} />)}
        </div>
      )}
      {hasNext && (
        <button type="button" className={t.moreBtn} onClick={loadMore} disabled={more}>
          {more ? 'fetching…' : 'Load more of the conversation'}
        </button>
      )}

      {!composerFirst && desk}
    </article>
  );
}
