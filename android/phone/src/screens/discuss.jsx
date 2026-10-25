// Opening things the phone way. `useOpener()` routes any item to the right page,
// as a slide-in page over the list you came from: an HN discussion (hnPage.jsx),
// a Reddit post with its thread (redditPage.jsx), a GitHub repo (repoPage.jsx),
// each in its room's split APK and loaded when this phone has the room; a video
// to the player. Today, Saved and Search all open things this way. Something
// from a room this phone doesn't have (a saved post, say) opens on the web.

import { Suspense, useCallback, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';

import { hasModule, moduleLazy } from '@pc/lib/modules.js';
import { useSaved } from '@pc/state.jsx';

import { openExternal } from '../lib/bridge.js';
import { usePlay } from '../lib/play.js';
import { IconBtn } from '../shell/Shell.jsx';

const HNPage = moduleLazy('hackernews', () => import('./hnPage.jsx'));
const RedditPage = moduleLazy('reddit', () => import('./redditPage.jsx'));
const RepoPage = moduleLazy('github', () => import('./repoPage.jsx'));

/** Save / unsave, for a page's bar. */
export function SaveIcon({ item }) {
  const { saved, toggleSaved } = useSaved();
  const on = !!saved[item.id];
  return (
    <IconBtn label={on ? 'Remove from Saved' : 'Save'} active={on} onClick={() => toggleSaved(item)}>
      {on ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
    </IconBtn>
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
    const here = hasModule(it.platform);
    if (here && (it.platform === 'youtube' || it.platform === 'anime')) play(it, from);
    else if (here && it.platform === 'reddit') setPost(it);
    else if (here && it.platform === 'github') setRepo(it);
    else if (here && it.platform === 'hackernews') setHn(it);
    else if (it.platform === 'hackernews' && it.extra?.hn_id) openExternal(`https://news.ycombinator.com/item?id=${it.extra.hn_id}`);
    else if (it.url) openExternal(it.url);
  }, [onOpen, play]);
  const pages = (
    <Suspense fallback={null}>
      {hn && <HNPage item={hn} onClose={() => setHn(null)} />}
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
      {repo && <RepoPage item={repo} onClose={() => setRepo(null)} />}
    </Suspense>
  );
  return [open, pages];
}
