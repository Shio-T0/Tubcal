// Open a saved entry from wherever it's listed (the Saved page, the drawer, the
// command palette): a video or a moment plays in the player, a Reddit post, an HN
// story or a repo opens in its own reader over the current page, an in-app
// address is navigated to, and anything else opens in a new tab.
//
//   const { openItem, modals } = useOpenSaved();
//   …  <Row onClick={() => openItem(item)} />  …  {modals}

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { kindOf } from '../../lib/saveable.js';
import { usePlayer } from '../../state.jsx';
import RedditPostModal from '../modals/RedditPostModal.jsx';
import RepoDetailModal from '../modals/RepoDetailModal.jsx';
import { ReaderSheet } from '../wire/HNReader.jsx';

export function useOpenSaved() {
  const navigate = useNavigate();
  const { open: play } = usePlayer();
  const [modal, setModal] = useState(null); // { type: 'reddit' | 'hn' | 'repo', item }
  const close = useCallback(() => setModal(null), []);

  const openItem = useCallback((item) => {
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
        setModal({ type: 'repo', item });
        return;
      case 'podcast':
        window.open(item.extra?.audio || item.url, '_blank', 'noopener');
        return;
      default:
        if (item.url?.startsWith('/')) navigate(item.url);
        else if (item.url) window.open(item.url, '_blank', 'noopener');
    }
  }, [navigate, play]);

  const modals = (
    <>
      <RedditPostModal item={modal?.type === 'reddit' ? modal.item : null} onClose={close} />
      {modal?.type === 'hn' && (
        <ReaderSheet
          item={modal.item}
          onClose={close}
          onItem={(id) => setModal({ type: 'hn', item: { id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } } })}
        />
      )}
      <RepoDetailModal item={modal?.type === 'repo' ? modal.item : null} onClose={close} />
    </>
  );

  return { openItem, modals };
}
