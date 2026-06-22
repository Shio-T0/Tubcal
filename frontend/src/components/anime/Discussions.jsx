import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Heart, MessageSquare, Send, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { Receiving } from '../layout/Section.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Button } from '../ui/index.jsx';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { useToast } from '../../state.jsx';
import c from './discussions.module.css';

function LikeButton({ id, type, liked, likes }) {
  const toast = useToast();
  const [on, setOn] = useState(!!liked);
  const [n, setN] = useState(likes || 0);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api('/anime/like', { method: 'POST', body: JSON.stringify({ id, type }) });
      setN((x) => x + (on ? -1 : 1));
      setOn((o) => !o);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
  return (
    <button className={`${c.like} ${on ? c.likeOn : ''}`} onClick={toggle} disabled={busy}>
      <Heart size={12} fill={on ? 'currentColor' : 'none'} /> {n > 0 ? compact(n) : ''}
    </button>
  );
}

function Composer({ placeholder, label, onSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const okDone = await onSubmit(text.trim());
    setBusy(false);
    if (okDone) setText('');
  };
  return (
    <div className={c.composer}>
      <textarea
        className={c.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
      />
      <Button onClick={submit} disabled={busy || !text.trim()}>
        <Send size={13} /> {label}
      </Button>
    </div>
  );
}

function ThreadModal({ threadId, onClose }) {
  const data = useApi(`/anime/thread/${threadId}`);
  const toast = useToast();
  const th = data.data?.thread;
  const comments = data.data?.comments || [];

  const postReply = async (text) => {
    try {
      await api(`/anime/thread/${threadId}/comment`, { method: 'POST', body: JSON.stringify({ text }) });
      toast('Reply posted to AniList', 'success');
      data.reload();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };

  return createPortal(
    <div className={c.overlay} onMouseDown={onClose}>
      <div className={c.modal} onMouseDown={(e) => e.stopPropagation()}>
        <button className={c.close} onClick={onClose} aria-label="Close"><X size={18} /></button>
        {data.loading && !data.data && <Receiving label="loading thread" />}
        {th && (
          <>
            <h2 className={c.modalTitle}>{th.title}</h2>
            <div className={c.byline}>
              <Avatar src={th.user.avatar} name={th.user.name} imgClass={c.av} letterClass={c.avL} />
              <span>{th.user.name}</span>
              <span className={c.dot}>·</span>
              <span>{timeAgo(th.created_at)}</span>
            </div>
            {th.body && <p className={c.body}>{th.body}</p>}
            <div className={c.comments}>
              {comments.map((cm) => (
                <div key={cm.id} className={c.comment}>
                  <Avatar src={cm.user.avatar} name={cm.user.name} imgClass={c.av} letterClass={c.avL} />
                  <div className={c.commentBody}>
                    <div className={c.commentHead}>
                      {cm.user.name} <span className={c.time}>{timeAgo(cm.created_at)}</span>
                    </div>
                    <div className={c.commentText}>{cm.comment}</div>
                    <LikeButton id={cm.id} type="THREAD_COMMENT" liked={cm.liked} likes={cm.likes} />
                  </div>
                </div>
              ))}
            </div>
            <Composer placeholder="Write a reply…" label="Reply" onSubmit={postReply} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ForumList({ mediaId }) {
  const threads = useApi(`/anime/threads${mediaId ? `?media_id=${mediaId}` : ''}`);
  const [openId, setOpenId] = useState(null);
  if (threads.loading && !threads.data) return <Receiving label="opening the forum" />;
  if (threads.error) return <p className={c.muted}>Couldn't load threads.</p>;
  const items = threads.data?.items || [];
  if (!items.length) return <p className={c.muted}>No threads here yet.</p>;
  return (
    <>
      <div className={c.threadList}>
        {items.map((t) => (
          <button key={t.id} className={c.threadRow} onClick={() => setOpenId(t.id)}>
            <div className={c.threadTitle}>{t.title}</div>
            <div className={c.threadMeta}>
              <Avatar src={t.user.avatar} name={t.user.name} imgClass={c.av} letterClass={c.avL} />
              <span>{t.user.name}</span>
              <span className={c.dot}>·</span>
              <MessageSquare size={12} /> {compact(t.replies || 0)}
            </div>
          </button>
        ))}
      </div>
      {openId && <ThreadModal threadId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ActivityCard({ a }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const reply = async (text) => {
    try {
      await api(`/anime/activity/${a.id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      toast('Reply posted to AniList', 'success');
      setReplying(false);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  return (
    <div className={c.activity}>
      <Avatar src={a.user.avatar} name={a.user.name} imgClass={c.av} letterClass={c.avL} />
      <div className={c.activityBody}>
        <div className={c.commentHead}>
          {a.user.name} <span className={c.time}>{timeAgo(a.created_at)}</span>
        </div>
        {a.kind === 'TextActivity' ? (
          <div className={c.commentText}>{a.text}</div>
        ) : (
          <div className={c.commentText}>
            {a.status}{a.progress ? ` ${a.progress} of` : ''}{' '}
            {a.media?.id ? (
              <Link to={`/anime/${a.media.id}`} className={c.aLink}>{a.media.title}</Link>
            ) : (
              a.media?.title
            )}
          </div>
        )}
        <div className={c.activityActions}>
          <LikeButton id={a.id} type="ACTIVITY" liked={a.liked} likes={a.likes} />
          <button className={c.reBtn} onClick={() => setReplying((r) => !r)}>
            <MessageSquare size={12} /> {a.replies > 0 ? compact(a.replies) : 'Reply'}
          </button>
        </div>
        {replying && <Composer placeholder="Write a reply…" label="Reply" onSubmit={reply} />}
      </div>
    </div>
  );
}

export function ActivityFeed({ mediaId }) {
  const feed = useApi(`/anime/activity${mediaId ? `?media_id=${mediaId}` : ''}`);
  const toast = useToast();
  const post = async (text) => {
    try {
      await api('/anime/activity', { method: 'POST', body: JSON.stringify({ text }) });
      toast('Posted to AniList', 'success');
      feed.reload();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const items = feed.data?.items || [];
  return (
    <div className={c.feed}>
      {!mediaId && <Composer placeholder="Share a status with AniList…" label="Post" onSubmit={post} />}
      {feed.loading && !feed.data && <Receiving label="loading activity" />}
      {feed.error && <p className={c.muted}>Couldn't load activity.</p>}
      {items.map((a) => (
        <ActivityCard key={a.id} a={a} />
      ))}
    </div>
  );
}
