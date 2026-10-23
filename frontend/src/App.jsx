import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import Backdrop from './components/layout/Backdrop.jsx';
import CommandPalette from './components/layout/CommandPalette.jsx';
import KeyboardShortcuts from './components/layout/KeyboardShortcuts.jsx';
import OfflineBanner from './components/layout/OfflineBanner.jsx';
import { CodingFrame } from './components/channels/CodingFrame.jsx';
import { DeskFrame, useRememberPlace } from './components/channels/DeskFrame.jsx';
import { SocialFrame } from './components/channels/SocialFrame.jsx';
import { VideoFrame } from './components/channels/VideoFrame.jsx';
import Pocket from './components/pocket/Pocket.jsx';
import PlayerLayer from './components/player/PlayerLayer.jsx';
import { Spinner } from './components/ui/index.jsx';
import { hasModule as has, moduleLazy } from './lib/modules.js';
import { AppProviders } from './state.jsx';

// Home is the "/" channel chooser — keep it eager so first paint has no chunk
// wait. Every room is code-split and fetched on first visit.
import Home from './pages/Home.jsx';

// Every room is a module an install can leave out (modules.ini): its routes are
// only here when it is (`has`, lib/modules.js), and its pages load through
// import(), which the build points at an empty stand-in when it isn't built.

const Edition = lazy(() => import('./pages/Edition.jsx'));
const ScreeningRoom = lazy(() => import('./pages/ScreeningRoom.jsx'));
const ChannelPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.ChannelPage })));
const PlaylistPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.PlaylistPage })));
const HistoryPage = lazy(() => import('./pages/ScreeningRoom.jsx').then(m => ({ default: m.HistoryPage })));
const Dispatch = lazy(() => import('./pages/Dispatch.jsx'));
const SubredditPage = lazy(() => import('./pages/Dispatch.jsx').then(m => ({ default: m.SubredditPage })));
const Wire = lazy(() => import('./pages/Wire.jsx'));
const ByTopic = lazy(() => import('./pages/ByTopic.jsx'));
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
const GithubRepo = lazy(() => import('./pages/GithubRepo.jsx'));
const GithubThread = lazy(() => import('./pages/GithubRepo.jsx').then(m => ({ default: m.GithubThread })));
const GithubCommit = lazy(() => import('./pages/GithubRepo.jsx').then(m => ({ default: m.GithubCommit })));
const GithubUser = lazy(() => import('./pages/GithubUser.jsx'));
const Workbench = lazy(() => import('./pages/Workbench.jsx'));
const Composer = lazy(() => import('./pages/Composer.jsx'));
const SavedPage = lazy(() => import('./pages/SavedPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const AnimeSection = moduleLazy('anime', () => import('./components/anime/AnimeSection.jsx'));
const CurtainCallHost = moduleLazy('anime', () => import('./components/anime/CurtainCallHost.jsx'));

function RouteFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <Spinner />
    </div>
  );
}

// The shell holds "/" (the home screen, no chrome), the three channels — Social,
// Coding and Video, each in its own frame (components/channels/) — and Saved &
// Settings, which belong to no channel. Each frame keeps its own Suspense
// boundary so a lazy page loading never blanks the frame around it.
function framed(Frame) {
  return function FramedLayout() {
    return (
      <Frame>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </Frame>
    );
  };
}
const SocialLayout = framed(SocialFrame);
const CodingLayout = framed(CodingFrame);
const DeskLayout = framed(DeskFrame);

// The Video channel's frame holds the Screening Room, the Archive and the Anime
// alike, so moving between them never rebuilds the console. The Anime's routes
// add its path bar and the watch-time calculator (components/anime/AnimeSection.jsx).
const VideoLayout = framed(VideoFrame);

function RememberPlace() {
  useRememberPlace();
  return null;
}

export default function App() {
  return (
    <AppProviders>
      <Backdrop />
      <div className="app-shell">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route element={<SocialLayout />}>
              {has('edition') && <Route path="/edition" element={<Edition />} />}
              {has('hackernews') && <Route path="/hackernews" element={<Wire />} />}
              {has('topics') && <Route path="/hackernews/topics" element={<ByTopic />} />}
              {has('reddit') && <Route path="/reddit" element={<Dispatch />} />}
              {has('reddit') && <Route path="/reddit/r/:sub" element={<SubredditPage />} />}
            </Route>
            <Route element={<CodingLayout />}>
              {has('editor') && <Route path="/editor" element={<Composer />} />}
              {has('dev') && <Route path="/dev" element={<Workbench />} />}
              {has('github') && (
                <>
                  <Route path="/github" element={<Github />} />
                  <Route path="/github/r/:owner/:repo" element={<GithubRepo />} />
                  <Route path="/github/r/:owner/:repo/issues/:number" element={<GithubThread kind="issue" />} />
                  <Route path="/github/r/:owner/:repo/pull/:number" element={<GithubThread kind="pull" />} />
                  <Route path="/github/r/:owner/:repo/commit/:sha" element={<GithubCommit />} />
                  <Route path="/github/u/:login" element={<GithubUser />} />
                </>
              )}
            </Route>
            <Route element={<VideoLayout />}>
              {has('youtube') && (
                <>
                  <Route path="/youtube" element={<ScreeningRoom />} />
                  <Route path="/youtube/c/:channelId" element={<ChannelPage />} />
                  <Route path="/youtube/playlist/:playlistId" element={<PlaylistPage />} />
                  <Route path="/youtube/history" element={<HistoryPage />} />
                </>
              )}
              {has('archive') && <Route path="/archive" element={<Archive />} />}
              {has('anime') && (
                <Route element={<AnimeSection fallback={<RouteFallback />} />}>
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
              )}
            </Route>
            <Route element={<DeskLayout />}>
              <Route path="/saved" element={<SavedPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <PlayerLayer />
      <Suspense fallback={null}>
        <CurtainCallHost />
      </Suspense>
      <Pocket />
      <RememberPlace />
      <CommandPalette />
      <KeyboardShortcuts />
      <OfflineBanner />
    </AppProviders>
  );
}