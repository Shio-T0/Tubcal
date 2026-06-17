import { Navigate, Route, Routes } from 'react-router-dom';

import Backdrop from './components/layout/Backdrop.jsx';
import Masthead from './components/layout/Masthead.jsx';
import PlayerLayer from './components/player/PlayerLayer.jsx';
import { AppProviders } from './state.jsx';

import FrontPage from './pages/FrontPage.jsx';
import ScreeningRoom, { ChannelPage, HistoryPage, PlaylistPage } from './pages/ScreeningRoom.jsx';
import Dispatch, { SubredditPage } from './pages/Dispatch.jsx';
import Wire from './pages/Wire.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <AppProviders>
      <Backdrop />
      <div className="app-shell">
        <Masthead />
        <Routes>
          <Route path="/" element={<FrontPage />} />
          <Route path="/youtube" element={<ScreeningRoom />} />
          <Route path="/youtube/c/:channelId" element={<ChannelPage />} />
          <Route path="/youtube/playlist/:playlistId" element={<PlaylistPage />} />
          <Route path="/youtube/history" element={<HistoryPage />} />
          <Route path="/reddit" element={<Dispatch />} />
          <Route path="/reddit/r/:sub" element={<SubredditPage />} />
          <Route path="/hackernews" element={<Wire />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <PlayerLayer />
    </AppProviders>
  );
}
