// Opening and folding the player, with the picture travelling: tap a thumbnail
// and it grows into the stage; minimise and the stage shrinks into the mini bar;
// tap the mini bar and it grows back. Every phone call site that opens or folds
// the player goes through here (see lib/motion.js → morph).

import { useMemo } from 'react';

import { usePlayer } from '@pc/state.jsx';

import { morph } from './motion.js';

/** The picture inside a tapped element, if there is one (what should travel). */
const pictureIn = (el) => (el ? el.querySelector?.('img') || el : null);

export function usePlay() {
  const { open, expandFromDock, minimize } = usePlayer();
  return useMemo(() => ({
    /** Play `item`; `from` is the tapped element (its picture travels). */
    play: (item, from) => morph(() => open(item), { from: pictureIn(from), kind: 'open' }),
    expand: (id) => morph(() => expandFromDock(id), { kind: 'open' }),
    minimize: () => morph(minimize, { kind: 'close' }),
  }), [open, expandFromDock, minimize]);
}
