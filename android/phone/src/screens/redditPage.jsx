// A Reddit post and its thread as a slide-in page (the Reddit room's part of the
// phone app, in its split APK). discuss.jsx's opener loads it when this phone has
// the room.

import { ArrowUpRight, ExternalLink, MessageCircle, Share2, TrendingUp } from 'lucide-react';

import { useApi } from '@pc/api/client.js';
import CommentThread from '@pc/components/modals/CommentThread.jsx';
import SafeHtml from '@pc/components/modals/SafeHtml.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';

import { openExternal, share } from '../lib/bridge.js';
import { ErrorNote, IconBtn, Loading, Overlay } from '../shell/Shell.jsx';
import { SaveIcon } from './discuss.jsx';
import d from './discuss.module.css';

/** A Reddit post and its thread. */
export function RedditPage({ item, onClose }) {
  const res = useApi(item ? `/reddit/post/${item.extra.subreddit}/${item.extra.post_id}` : '', !!item);
  if (!item) return null;
  const data = res.data;
  const post = data?.post || item;
  const pic = item.thumbnail && !item.extra?.is_self ? item.thumbnail : null;
  const link = item.extra?.link_url;
  return (
    <Overlay
      open
      onClose={onClose}
      title={item.source}
      sub={`${item.author ? `u/${item.author} · ` : ''}${ago(item.published_at)}`}
      tone="var(--c-reddit)"
      actions={
        <>
          <SaveIcon item={item} />
          <IconBtn label="Share" onClick={() => share({ title: item.title, url: item.url })}><Share2 size={20} /></IconBtn>
        </>
      }
    >
      <article className={d.post} data-reveal="fade">
        <h2 className={d.title}>{item.title}</h2>
        <div className={d.stats}>
          {post.score != null && <span><TrendingUp size={14} /> {compact(post.score)}</span>}
          {post.comments_count != null && <span><MessageCircle size={14} /> {compact(post.comments_count)}</span>}
          <button type="button" onClick={() => openExternal(item.url)}>Reddit <ExternalLink size={13} /></button>
        </div>
        {pic && <img className={d.pic} src={pic} alt="" />}
        {link && (
          <button type="button" className={d.link} onClick={() => openExternal(link)}>
            <ArrowUpRight size={16} />
            <span>{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
          </button>
        )}
        {data?.selftext_html && <SafeHtml html={data.selftext_html} className={d.rich} />}
      </article>
      <div className={d.thread}>
        <h3 className={d.threadHead}>Comments</h3>
        {data?.limited && <p className={d.note}>Reddit limits anonymous access, so comments arrive flattened and without scores. Connect your Reddit account in Settings for full threads.</p>}
        {res.loading && !data && <Loading label="collecting the thread" />}
        {res.error && <ErrorNote message={res.error} onRetry={res.reload} />}
        {data && <CommentThread comments={data.comments} />}
      </div>
    </Overlay>
  );
}

export default RedditPage;
