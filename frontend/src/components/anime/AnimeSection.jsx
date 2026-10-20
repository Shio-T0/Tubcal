// The Anime's layout route: its path bar (AnimeLayout) and the watch-time
// calculator (The Reckoner) — a single instance across all of the Anime: hover a
// title anywhere in it, tap C, and the same tally grows. App.jsx loads this
// lazily, so a copy without the Anime never touches its files.

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { AnimeLayout } from './AnimeTree.jsx';
import { AnimeCalcProvider } from './WatchCalculator.jsx';

export default function AnimeSection({ fallback = null }) {
  return (
    <AnimeCalcProvider>
      <AnimeLayout>
        <Suspense fallback={fallback}>
          <Outlet />
        </Suspense>
      </AnimeLayout>
    </AnimeCalcProvider>
  );
}
