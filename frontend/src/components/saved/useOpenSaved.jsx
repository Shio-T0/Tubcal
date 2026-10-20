// Open a saved entry from wherever it's listed (the Saved page, the drawer, the
// command palette): a video or a moment plays in the player, a Reddit post or an
// HN story opens in its own reader over the current page, anything from GitHub
// opens its page in the GitHub room, an in-app address is navigated to, and
// anything else opens in a new tab.
//
//   const { openItem, modals } = useOpenSaved();
//   …  <Row onClick={() => openItem(item)} />  …  {modals}

import { Suspense, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { kindOf } from '../../lib/saveable.js';
import { hasModule, moduleLazy, moduleLazyNamed } from '../../lib/modules.js';
import { anyRoomOfPath, getRoomById, roomOfPath } from '../../lib/rooms.js';
import { usePlayer, useToast } from '../../state.jsx';
import { itemPath } from '../../lib/gh.js';

// The readers belong to the Dispatch and the Wire (lib/modules.js).
const RedditPostModal = moduleLazy('reddit', () => import('../modals/RedditPostModal.jsx'));
const ReaderSheet = moduleLazyNamed('hackernews', () => import('../wire/HNReader.jsx'), 'ReaderSheet');

// Which module opens each kind in place. Something saved from a room this copy
// doesn't have (it was removed after) opens on the web instead.
const NEEDS = {
  video: 'youtube', moment: 'youtube', post: 'reddit', story: 'hackernews',
  repo: 'github', release: 'github', pull: 'github', issue: 'github', commit: 'github', ghuser: 'github', event: 'github',
};

function webUrl(item) {
  if (kindOf(item) === 'story') return `https://news.ycombinator.com/item?id=${item.extra?.hn_id || String(item.id).replace(/^hn:/, '')}`;
  if (kindOf(item) === 'moment') return item.extra?.video?.url || item.url;
  return item.url?.startsWith('/') ? null : item.url;
}

export function useOpenSaved() {
  const navigate = useNavigate();
  const { open: play } = usePlayer();
  const toast = useToast();
  const [modal, setModal] = useState(null); // { type: 'reddit' | 'hn', item }
  const close = useCallback(() => setModal(null), []);

  const openItem = useCallback((item) => {
    const absent = (room) => toast(`${room.label} isn't installed here. Add it with: tubcal add ${room.id}`);
    const needs = NEEDS[kindOf(item)];
    if (needs && !hasModule(needs)) {
      const url = webUrl(item);
      if (url) window.open(url, '_blank', 'noopener');
      else absent(getRoomById(needs) || { label: needs, id: needs });
      return;
    }
    switch (kindOf(item)) {
      case 'video':
        play(item);
        return;
      case 'moment':
        if (item.extra?.video) play(item.extra.video, { start: item.extra.t || 0 });
        return;
      case 'post':
        setModal({ type: 'reddit', item });
        return;
      case 'story':
        setModal({ type: 'hn', item });
        return;
      case 'repo':
      case 'release':
      case 'pull':
      case 'issue':
      case 'commit':
      case 'ghuser':
      case 'event': {
        const to = itemPath(item);
        if (to) navigate(to);
        else if (item.url) window.open(item.url, '_blank', 'noopener');
        return;
      }
      case 'podcast':
        window.open(item.extra?.audio || item.url, '_blank', 'noopener');
        return;
      default:
        if (item.url?.startsWith('/')) {
          // an in-app address (an editor file, an anime page…) whose room is here
          const path = item.url.split('?')[0];
          const room = anyRoomOfPath(path);
          if (room && !roomOfPath(path)) absent(room);
          else navigate(item.url);
        } else if (item.url) window.open(item.url, '_blank', 'noopener');
    }
  }, [navigate, play, toast]);

  const modals = (
    <Suspense fallback={null}>
      {modal?.type === 'reddit' && <RedditPostModal item={modal.item} onClose={close} />}
      {modal?.type === 'hn' && (
        <ReaderSheet
          item={modal.item}
          onClose={close}
          onItem={(id) => setModal({ type: 'hn', item: { id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } } })}
        />
      )}
    </Suspense>
  );

  return { openItem, modals };
}
