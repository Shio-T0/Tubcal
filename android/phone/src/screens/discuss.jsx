// The reading pages every text room shares, as slide-in pages over the list
// you came from: an HN discussion (the desktop's reader, threaded, with "new
// since your last visit"), a Reddit post with its thread, a GitHub repo with its
// releases and README. `useOpener()` routes any item to the right one — a video
// to the player — so Today, Read, Saved and Search all open things the same way.

import { useCallback, useRef, useState } from 'react';
import {
  ArrowUpRight, Bookmark, BookmarkCheck, ExternalLink, GitFork, MessageCircle, Share2, Star, Tag, TrendingUp,
} from 'lucide-react';

import { useApi } from '@pc/api/client.js';
import CommentThread from '@pc/components/modals/CommentThread.jsx';
import SafeHtml from '@pc/components/modals/SafeHtml.jsx';
import { HNReader, splitKind } from '@pc/components/wire/HNReader.jsx';
import { compact } from '@pc/lib/format.js';
import { ago } from '@pc/lib/time.js';
import { useSaved } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import { usePlay } from '../lib/play.js';
import { IconBtn, Loading, ErrorNote, Overlay } from '../shell/Shell.jsx';
import d from './discuss.module.css';

function SaveIcon({ item }) {
  const { saved, toggleSaved } = useSaved();
  const on = !!saved[item.id];
  return (
    <IconBtn label={on ? 'Remove from Saved' : 'Save'} active={on} onClick={() => toggleSaved(item)}>
      {on ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
    </IconBtn>
  );
}

/** An HN story's discussion. Links to other HN items inside it open in place. */
export function HNPage({ item, onClose }) {
  const [stack, setStack] = useState([]);
  const cur = stack[stack.length - 1] || item;
  const hnId = cur?.extra?.hn_id;
  const body = useRef(null);
  // Back steps out of a linked item first; only then does the page close.
  const back = () => {
    if (!stack.length) return false;
    setStack((s) => s.slice(0, -1));
    return true;
  };
  const onItem = (id) => {
    setStack((s) => [...s, { id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } }]);
    body.current?.scrollTo(0, 0);
  };
  const { kind } = splitKind(cur?.title || '');
  const url = `https://news.ycombinator.com/item?id=${hnId}`;
  return (
    <Overlay
      open={!!item}
      onClose={onClose}
      onBack={back}
      title="Discussion"
      sub={kind || cur?.extra?.domain || 'Hacker News'}
      tone="var(--c-hn)"
      bodyRef={body}
      actions={<IconBtn label="Share" onClick={() => share({ title: cur?.title, url })}><Share2 size={20} /></IconBtn>}
    >
      {cur && (
        <div className={d.hn}>
          <HNReader key={hnId} item={cur.title ? cur : undefined} hnId={hnId} onItem={onItem} variant="sheet" />
        </div>
      )}
    </Overlay>
  );
}

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

/** A GitHub repository: description, numbers, topics, releases, README. */
export function RepoPage({ item, onClose }) {
  const fullName = item?.extra?.repo || item?.source || null;
  const res = useApi(fullName ? `/github/item/${fullName}` : '', !!fullName);
  if (!item) return null;
  const data = res.data;
  const repo = data?.story || item;
  const x = repo.extra || item.extra || {};
  const url = `https://github.com/${fullName}`;
  return (
    <Overlay
      open
      onClose={onClose}
      title={fullName}
      sub={repo.author || 'repository'}
      tone="var(--c-github)"
      actions={
        <>
          <SaveIcon item={item} />
          <IconBtn label="Share" onClick={() => share({ title: fullName, url })}><Share2 size={20} /></IconBtn>
        </>
      }
    >
      <article className={d.post} data-reveal="fade">
        {repo.title && repo.title !== fullName && <h2 className={d.title}>{repo.title}</h2>}
        {x.description && <p className={d.desc}>{x.description}</p>}
        <div className={d.stats}>
          {x.stars != null && <span><Star size={14} /> {compact(x.stars)}</span>}
          {x.forks != null && <span><GitFork size={14} /> {compact(x.forks)}</span>}
          {x.language && <span><Tag size={14} /> {x.language}</span>}
          <button type="button" onClick={() => openExternal(url)}>GitHub <ExternalLink size={13} /></button>
        </div>
        {x.topics?.length > 0 && (
          <div className={d.topics}>{x.topics.slice(0, 14).map((t) => <span key={t}>{t}</span>)}</div>
        )}
      </article>
      {res.loading && !data && <Loading label="cloning the details" />}
      {res.error && <ErrorNote message={res.error} onRetry={res.reload} />}
      {data?.releases?.length > 0 && (
        <section className={d.thread}>
          <h3 className={d.threadHead}>Releases</h3>
          {data.releases.map((r) => (
            <button key={r.id} type="button" className={d.release} onClick={() => openExternal(r.url)} data-reveal="side">
              <b>{r.title}</b>
              <span>{r.extra?.tag} · {ago(r.published_at)}{r.extra?.prerelease ? ' · pre-release' : ''}</span>
            </button>
          ))}
        </section>
      )}
      {data?.readme_html && (
        <section className={d.thread}>
          <h3 className={d.threadHead}>README</h3>
          <SafeHtml html={data.readme_html} className={d.rich} />
        </section>
      )}
    </Overlay>
  );
}

/** Open any feed item the phone way. Returns `[open, pages]` — render `pages`. */
export function useOpener({ onOpen } = {}) {
  const { play } = usePlay();
  const [hn, setHn] = useState(null);
  const [post, setPost] = useState(null);
  const [repo, setRepo] = useState(null);
  const open = useCallback((it, from) => {
    if (!it) return;
    onOpen?.(it);
    if (it.platform === 'youtube' || it.platform === 'anime') play(it, from);
    else if (it.platform === 'reddit') setPost(it);
    else if (it.platform === 'github') setRepo(it);
    else if (it.platform === 'hackernews') setHn(it);
    else if (it.url) openExternal(it.url);
  }, [onOpen, play]);
  const pages = (
    <>
      {hn && <HNPage item={hn} onClose={() => setHn(null)} />}
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
      {repo && <RepoPage item={repo} onClose={() => setRepo(null)} />}
    </>
  );
  return [open, pages];
}
