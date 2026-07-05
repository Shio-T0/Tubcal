import { useState } from 'react';
import { Bookmark } from 'lucide-react';

import { SectionHead } from '../components/layout/Section.jsx';
import HNCommentsPanel from '../components/modals/HNCommentsPanel.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import RepoDetailModal from '../components/modals/RepoDetailModal.jsx';
import { EmptyState } from '../components/ui/index.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { timeAgo } from '../lib/time.js';
import { usePlayer, useSaved } from '../state.jsx';
import { VideoTile } from './ScreeningRoom.jsx';
import s from './saved.module.css';

const PLATFORM_LABEL = {
  youtube: 'Screening Room',
  reddit: 'The Dispatch',
  hackernews: 'The Wire',
  github: 'GitHub',
};

// Compact card for saved Reddit posts / HN stories (videos use VideoTile).
function SavedCard({ item, onOpen }) {
  return (
    <article className={s.card} onClick={() => onOpen(item)}>
      <SaveButton item={item} className={s.cardSave} />
      <span className={s.cardTag} data-platform={item.platform}>
        {PLATFORM_LABEL[item.platform]}
      </span>
      <h3 className={s.cardTitle}>{item.title}</h3>
      <span className={s.cardMeta}>
        {item.source}
        {item.author ? ` · ${item.author}` : ''}
        {timeAgo(item.published_at) ? ` · ${timeAgo(item.published_at)}` : ''}
      </span>
    </article>
  );
}

export default function SavedPage() {
  const { saved } = useSaved();
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);

  const items = Object.values(saved);
  const youtube = items.filter((i) => i.platform === 'youtube');
  const reddit = items.filter((i) => i.platform === 'reddit');
  const hn = items.filter((i) => i.platform === 'hackernews');
  const github = items.filter((i) => i.platform === 'github');

  const openOther = (item) => {
    if (item.platform === 'reddit') setPost(item);
    else if (item.platform === 'hackernews') setThread(item);
    else if (item.platform === 'github') setSelectedRepo(item);
    else window.open(item.url, '_blank', 'noopener');
  };

  return (
    <>
      <SectionHead
        kicker="Saved"
        title="Your reading & watch list"
        note="Everything you bookmarked, across every room — kept locally on this machine."
        color="var(--c-foryou)"
      />

      {items.length === 0 && (
        <EmptyState
          icon={<Bookmark size={30} />}
          color="var(--c-foryou)"
          title="Nothing saved yet"
          subtitle="Tap the bookmark on any video, post, or story to keep it here for later."
        />
      )}

      {youtube.length > 0 && (
        <section className={s.group}>
          <h2 className={s.groupHead}>Videos</h2>
          <div className={s.grid}>
            {youtube.map((item) => (
              <VideoTile key={item.id} item={item} onPlay={playVideo} />
            ))}
          </div>
        </section>
      )}

      {(reddit.length > 0 || hn.length > 0 || github.length > 0) && (
        <section className={s.group}>
          <h2 className={s.groupHead}>Posts & stories</h2>
          <div className={s.cards}>
            {[...reddit, ...hn, ...github].map((item) => (
              <SavedCard key={item.id} item={item} onOpen={openOther} />
            ))}
          </div>
        </section>
      )}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      <HNCommentsPanel item={thread} onClose={() => setThread(null)} />
      <RepoDetailModal item={selectedRepo} onClose={() => setSelectedRepo(null)} />
    </>
  );
}
