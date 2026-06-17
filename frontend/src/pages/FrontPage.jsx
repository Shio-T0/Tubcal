import { useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox, Receiving, SectionHead } from '../components/layout/Section.jsx';
import HNCommentsPanel from '../components/modals/HNCommentsPanel.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import { IconButton } from '../components/ui/index.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { COMPLETE_RATIO, useProgress, usePlayer } from '../state.jsx';
import s from './front.module.css';

// Thin watch-progress bar for YouTube items (matches the Screening Room tiles).
function ProgressBar({ item }) {
  const { progress } = useProgress();
  const p = progress[item.id];
  const ratio = p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  if (ratio <= 0) return null;
  const done = ratio >= COMPLETE_RATIO;
  return (
    <div className={s.ytProgress}>
      <div
        className={`${s.ytProgressFill} ${done ? s.ytProgressDone : ''}`}
        style={{ width: `${done ? 100 : Math.max(3, ratio * 100)}%` }}
      />
    </div>
  );
}

const PLATFORM = {
  youtube: { color: 'var(--c-youtube)', tag: 'Screening Room' },
  reddit: { color: 'var(--c-reddit)', tag: 'The Dispatch' },
  hackernews: { color: 'var(--c-hn)', tag: 'The Wire' },
};

function itemMeta(item) {
  const bits = [item.source];
  if (item.score != null) bits.push(`▲ ${compact(item.score)}`);
  if (item.comments_count != null) bits.push(`${compact(item.comments_count)} cmt`);
  bits.push(timeAgo(item.published_at));
  return bits.join(' · ');
}

export default function FrontPage() {
  const feed = useApi('/feed/foryou');
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);

  const open = (item) => {
    if (item.platform === 'youtube') playVideo(item);
    else if (item.platform === 'reddit') setPost(item);
    else setThread(item);
  };

  const refresh = async () => {
    try {
      await api('/refresh?scope=all', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    feed.reload();
  };

  const items = feed.data?.items || [];
  const lede = items.find((i) => i.thumbnail) || items[0];
  const rest = items.filter((i) => i !== lede);

  return (
    <>
      <SectionHead
        kicker="No 01 — Front Page"
        title="Today, across your orbit"
        note="One stream from every room of the station, mixed to your weights."
        color="var(--c-foryou)"
      >
        <IconButton title="Refresh" onClick={refresh} spinning={feed.loading}>
          <RefreshCw size={16} />
        </IconButton>
      </SectionHead>

      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !feed.data && <Receiving label="composing the front page" />}

      {lede && (
        <article
          className={`${s.lede} ${lede.thumbnail ? '' : s.ledeNoImage}`}
          style={{ '--lede-c': PLATFORM[lede.platform].color }}
          onClick={() => open(lede)}
        >
          <div>
            <span className={s.ledeTag}>{PLATFORM[lede.platform].tag} — lead story</span>
            <h2 className={s.ledeTitle}>{lede.title}</h2>
            {lede.extra?.selftext_preview && (
              <p className={s.ledeExcerpt}>{lede.extra.selftext_preview}</p>
            )}
            <span className={s.ledeMeta}>{itemMeta(lede)}</span>
          </div>
          {lede.thumbnail && (
            <div className={s.ledeImageWrap}>
              <img className={s.ledeImage} src={lede.thumbnail} alt="" />
              {lede.platform === 'youtube' && (
                <div className={s.ledePlay}>
                  <span>
                    <Play size={20} fill="currentColor" />
                  </span>
                </div>
              )}
              {lede.platform === 'youtube' && <ProgressBar item={lede} />}
            </div>
          )}
          <SaveButton item={lede} className={s.saveCorner} />
        </article>
      )}

      <div className={s.columns}>
        {rest.map((item, i) => (
          <article
            key={item.id}
            className={s.colItem}
            style={{ '--i': i, '--item-c': PLATFORM[item.platform].color }}
            onClick={() => open(item)}
          >
            <span className={s.colTag}>{PLATFORM[item.platform].tag}</span>
            <SaveButton item={item} className={s.saveCorner} />
            <h3 className={s.colTitle}>{item.title}</h3>
            {item.platform === 'youtube' && item.thumbnail && (
              <div className={s.colThumbWrap}>
                <img className={s.colThumb} src={item.thumbnail} alt="" loading="lazy" />
                <ProgressBar item={item} />
              </div>
            )}
            <span className={s.colMeta}>{itemMeta(item)}</span>
          </article>
        ))}
      </div>

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      <HNCommentsPanel item={thread} onClose={() => setThread(null)} />
    </>
  );
}
