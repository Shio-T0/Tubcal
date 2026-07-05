import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Backdrop from './components/layout/Backdrop.jsx';
import CommandPalette from './components/layout/CommandPalette.jsx';
import KeyboardShortcuts from './components/layout/KeyboardShortcuts.jsx';
import Masthead from './components/layout/Masthead.jsx';
import OfflineBanner from './components/layout/OfflineBanner.jsx';
import PlayerLayer from './components/player/PlayerLayer.jsx';
import { Spinner } from './components/ui/index.jsx';
import { AppProviders } from './state.jsx';

// FrontPage is the "/" landing — keep it eager so first paint has no chunk wait.
// Every other room is code-split and fetched on first navigation to it.
import FrontPage from './pages/FrontPage.jsx';

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
const Github = lazy(() => import('./pages/Github.jsx'));
const SavedPage = lazy(() => import('./pages/SavedPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

function RouteFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <Spinner />
    </div>
  );
}

export default function App() {
  return (
    <AppProviders>
      <Backdrop />
      <div className="app-shell">
        <Masthead />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<FrontPage />} />
            <Route path="/edition" element={<Edition />} />
            <Route path="/youtube" element={<ScreeningRoom />} />
            <Route path="/youtube/c/:channelId" element={<ChannelPage />} />
            <Route path="/youtube/playlist/:playlistId" element={<PlaylistPage />} />
            <Route path="/youtube/history" element={<HistoryPage />} />
            <Route path="/reddit" element={<Dispatch />} />
            <Route path="/reddit/r/:sub" element={<SubredditPage />} />
            <Route path="/hackernews" element={<Wire />} />
            <Route path="/github" element={<Github />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/anime" element={<Anime />} />
            <Route path="/anime/:id" element={<AnimeDetail />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <PlayerLayer />
      <CommandPalette />
      <KeyboardShortcuts />
      <OfflineBanner />
    </AppProviders>
  );
}