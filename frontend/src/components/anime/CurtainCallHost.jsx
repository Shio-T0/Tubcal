// Listens for "you just finished a title" and raises the curtain call.
//
// The list sync (state.jsx) announces `anime-completed` when an edit comes back
// from AniList as COMPLETED — whether it was the player auto-marking the final
// episode or a +1 on the list. This host is mounted once at the app root (the
// player lives there too), queues those, and opens the screen — lazily, so its
// code only loads the first time you finish something.
//
// It never covers a film you're watching: while the big screen is up (the
// finale's credits, say) the call waits until you close it or send it to the
// corner. An automatic call happens once per title; the title page can always
// open it again by hand (openCurtainCall).

import { lazy, Suspense, useEffect, useState } from 'react';

import { usePlayer } from '../../state.jsx';

const CurtainCall = lazy(() => import('./CurtainCall.jsx'));
const SHOWN_KEY = 'tubcal.anime.curtain.shown';

function shownMap() {
  try { return JSON.parse(localStorage.getItem(SHOWN_KEY)) || {}; } catch { return {}; }
}
function markShown(id) {
  try {
    const m = shownMap();
    m[id] = Math.floor(Date.now() / 1000);
    localStorage.setItem(SHOWN_KEY, JSON.stringify(m));
  } catch { /* private mode: it may show again, no harm */ }
}

/** Open the curtain call for a title by hand (the title page's button). */
export function openCurtainCall(mediaId) {
  window.dispatchEvent(new CustomEvent('anime-completed', { detail: { mediaId: Number(mediaId), manual: true } }));
}

export default function CurtainCallHost() {
  const { expandedId } = usePlayer();
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    const on = (e) => {
      const { mediaId, manual } = e.detail || {};
      if (!mediaId) return;
      if (!manual && shownMap()[mediaId]) return;
      setQueue((q) => (q.some((x) => x.mediaId === mediaId) ? q : [...q, { mediaId, manual: !!manual }]));
    };
    window.addEventListener('anime-completed', on);
    return () => window.removeEventListener('anime-completed', on);
  }, []);

  const cur = queue[0];
  if (!cur || (expandedId && !cur.manual)) return null;
  return (
    <Suspense fallback={null}>
      <CurtainCall
        key={cur.mediaId}
        mediaId={cur.mediaId}
        manual={cur.manual}
        onShown={() => markShown(cur.mediaId)}
        onDone={() => setQueue((q) => q.slice(1))}
      />
    </Suspense>
  );
}
