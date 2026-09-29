import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import Backdrop from './components/layout/Backdrop.jsx';
import CommandPalette from './components/layout/CommandPalette.jsx';
import KeyboardShortcuts from './components/layout/KeyboardShortcuts.jsx';
import { HubFrame } from './components/layout/HubConsole.jsx';
import OfflineBanner from './components/layout/OfflineBanner.jsx';
import PlayerLayer from './components/player/PlayerLayer.jsx';
import { Spinner } from './components/ui/index.jsx';
import AnimeMasthead from './components/anime/AnimeMasthead.jsx';
import CurtainCallHost from './components/anime/CurtainCallHost.jsx';
import { AnimeLayout } from './components/anime/AnimeTree.jsx';
import { AnimeCalcProvider } from './components/anime/WatchCalculator.jsx';
import { AppProviders } from './state.jsx';

// Home is the "/" channel chooser — keep it eager so first paint has no chunk
// wait. Every room (and the Anime) is code-split and fetched on first visit.
import Home from './pages/Home.jsx';

const Edition = lazy(() => import('./pages/Edition.jsx'));
const ScreeningRoom = lazy(() => import('./pages/ScreeningRoom.jsx'));
const ChannelPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.ChannelPage })));
const PlaylistPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.PlaylistPage })));
const HistoryPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.HistoryPage })));
const Dispatch = lazy(() => import('./pages/Dispatch.jsx'));
const SubredditPage = lazy(() => import('./pages/Dispatch.jsx').then(m => ({ default: m.SubredditPage })));
const Wire = lazy(() => import('./pages/Wire.jsx'));
const Archive = lazy(() => import('./pages/Archive.jsx'));
const Anime = lazy(() => import('./pages/Anime.jsx'));
const AnimeDetail = lazy(() => import('./pages/Anime.jsx').then(m => ({ default: m.AnimeDetail })));
const VoiceActor = lazy(() => import('./pages/VoiceActor.jsx'));
const AnimeCharacter = lazy(() => import('./pages/AnimeCharacter.jsx'));
const AnimeStudio = lazy(() => import('./pages/AnimeStudio.jsx'));
const AnimeUser = lazy(() => import('./pages/AnimeUser.jsx'));
const AnimeThread = lazy(() => import('./pages/AnimeThread.jsx'));
const AnimeActivity = lazy(() => import('./pages/AnimeThread.jsx').then(m => ({ default: m.AnimeActivity })));
const Github = lazy(() => import('./pages/Github.jsx'));
const Workbench = lazy(() => import('./pages/Workbench.jsx'));
const Composer = lazy(() => import('./pages/Composer.jsx'));
const SavedPage = lazy(() => import('./pages/SavedPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

function RouteFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <Spinner />
    </div>
  );
}

// Three worlds share the shell: "/" (the chooser, no chrome), the Hub (the rooms,
// beside the hub console) and the Anime (its own section and top bar). Each layout
// keeps its own Suspense boundary so a lazy page loading never blanks the console
// or the bar around it.
function HubLayout() {
  return (
    <HubFrame>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </HubFrame>
  );
}

// The Anime's routes share one layout: its own top bar, and the index (a file
// tree of every view) beside the page — so the index stays put on a title or a
// character too. The watch-time calculator (The Reckoner) is a single instance
// across all of it — hover a title anywhere in here, tap C, and the same tally grows.
function AnimeSection() {
  return (
    <AnimeCalcProvider>
      <AnimeMasthead />
      <AnimeLayout>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </AnimeLayout>
    </AnimeCalcProvider>
  );
}

export default function App() {
  return (
    <AppProviders>
      <Backdrop />
      <div className="app-shell">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route element={<HubLayout />}>
              <Route path="/edition" element={<Edition />} />
              <Route path="/youtube" element={<ScreeningRoom />} />
              <Route path="/youtube/c/:channelId" element={<ChannelPage />} />
              <Route path="/youtube/playlist/:playlistId" element={<PlaylistPage />} />
              <Route path="/youtube/history" element={<HistoryPage />} />
              <Route path="/reddit" element={<Dispatch />} />
              <Route path="/reddit/r/:sub" element={<SubredditPage />} />
              <Route path="/hackernews" element={<Wire />} />
              <Route path="/github" element={<Github />} />
              <Route path="/dev" element={<Workbench />} />
              <Route path="/archive" element={<Archive />} />
              <Route path="/editor" element={<Composer />} />
              <Route path="/saved" element={<SavedPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route element={<AnimeSection />}>
              <Route path="/anime" element={<Anime />} />
              {/* Static segment outranks /anime/:id in the router's own ranking, so
                  a seiyuu id can never be mistaken for a media id. */}
              <Route path="/anime/voice/:id" element={<VoiceActor />} />
              <Route path="/anime/character/:id" element={<AnimeCharacter />} />
              <Route path="/anime/studio/:id" element={<AnimeStudio />} />
              <Route path="/anime/user/:name" element={<AnimeUser />} />
              <Route path="/anime/thread/:id" element={<AnimeThread />} />
              <Route path="/anime/activity/:id" element={<AnimeActivity />} />
              <Route path="/anime/:id" element={<AnimeDetail />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <PlayerLayer />
      <CurtainCallHost />
      <CommandPalette />
      <KeyboardShortcuts />
      <OfflineBanner />
    </AppProviders>
  );
}