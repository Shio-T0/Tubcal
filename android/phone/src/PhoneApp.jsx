// Tubcal on a phone. The same rooms and the same data as the desktop — every
// screen redrawn for one hand: five tabs at the bottom (Today, Watch, Anime,
// Read, More), full-screen pages that slide in and Back out, bottom sheets
// instead of menus and modals, long-press for a card's actions, pull down to
// refresh, and a player that lives above the tabs while you browse.
//
// Routes keep the desktop's URL scheme (/youtube/c/…, /anime/…, /anime/user/…),
// so the desktop components the phone reuses link to the right phone screens.

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { api } from '@pc/api/client.js';
import CurtainCallHost from '@pc/components/anime/CurtainCallHost.jsx';
import { useChannelFeed, useSeen } from '@pc/components/screening/feed.js';
import { AppProviders, usePlayer, useSettings, useSubscriptions } from '@pc/state.jsx';
import { THEMES } from '@pc/lib/themes.js';

import { setLightBars } from './lib/bridge.js';
import PhonePlayer from './player/PhonePlayer.jsx';
import { Loading, TabBar, tabOf } from './shell/Shell.jsx';

const Today = lazy(() => import('./screens/Today.jsx'));
const Watch = lazy(() => import('./screens/Watch.jsx'));
const Channel = lazy(() => import('./screens/Channel.jsx'));
const Playlist = lazy(() => import('./screens/Playlist.jsx'));
const History = lazy(() => import('./screens/History.jsx'));
const Read = lazy(() => import('./screens/Read.jsx'));
const Subreddit = lazy(() => import('./screens/Read.jsx').then((m) => ({ default: m.Subreddit })));
const AnimeHub = lazy(() => import('./screens/AnimeHub.jsx'));
const AnimeTitle = lazy(() => import('./screens/AnimeTitle.jsx'));
const More = lazy(() => import('./screens/More.jsx'));
const Search = lazy(() => import('./screens/Search.jsx'));
const Saved = lazy(() => import('./screens/Saved.jsx'));
const Reused = lazy(() => import('./screens/Reused.jsx'));

/** Where a fresh launch lands: the tab you were on last time. */
function Start() {
  let to = '/edition';
  try { to = localStorage.getItem('tubcal.phone.lastTab') || to; } catch { /* fine */ }
  return <Navigate to={to} replace />;
}

/** New pages start at the top; Back returns you to where you were on the page. */
function useScrollMemory() {
  const loc = useLocation();
  const nav = useNavigationType();
  const pos = useRef(new Map());
  useEffect(() => {
    const save = () => pos.current.set(loc.key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [loc.key]);
  useLayoutEffect(() => {
    const y = nav === 'POP' ? pos.current.get(loc.key) || 0 : 0;
    window.scrollTo(0, y);
    // a list that loads after we land gets a second chance to reach the old spot
    if (y) setTimeout(() => window.scrollTo(0, y), 350);
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Status-bar icons follow the skin: dark icons over a light-backed skin. */
function useBarsFollowTheme() {
  const { settings } = useSettings();
  const theme = settings?.theme || 'dark';
  useEffect(() => {
    const meta = THEMES.find((t) => t.value === theme);
    const light = meta?.light ?? ['light', 'bauhaus', 'aqua'].includes(theme);
    setLightBars(light);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#1c140d');
  }, [theme]);
}

/** Counts for the tab badges: new uploads (Watch) and unread AniList mail (Anime). */
function useBadges() {
  const { subs } = useSubscriptions();
  const { feed } = useChannelFeed();
  const { newCount } = useSeen();
  const watch = subs.youtube.length ? newCount(feed.data?.items) : 0;
  const [anime, setAnime] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => api('/anime/notifications/count').then((d) => alive && setAnime(d.unread || 0)).catch(() => {});
    const t0 = setTimeout(poll, 4000); // after the first screen has had the network
    const t = setInterval(poll, 300_000);
    const read = () => setAnime(0);
    window.addEventListener('anime-inbox-read', read);
    return () => { alive = false; clearTimeout(t0); clearInterval(t); window.removeEventListener('anime-inbox-read', read); };
  }, []);
  return { watch, anime };
}

/** Each screen arrives the way you got there: forward slides in from the right,
 *  Back from the left, another tab fades up. Keyed on the path only, so a filter
 *  or chip (the query string) never re-plays it. */
function PageTransition({ children }) {
  const { pathname } = useLocation();
  const nav = useNavigationType();
  const prev = useRef(pathname);
  const enter = useRef({ path: pathname, kind: 'tab' });
  if (enter.current.path !== pathname) {
    const a = tabOf(prev.current);
    const b = tabOf(pathname);
    enter.current = {
      path: pathname,
      // a different tab, or a sideways switch inside one (Read's rooms), fades up
      kind: a?.key !== b?.key || nav === 'REPLACE' ? 'tab' : nav === 'POP' ? 'back' : 'push',
    };
  }
  useEffect(() => { prev.current = pathname; }, [pathname]);
  return (
    <div key={pathname} className="ph-page" data-enter={enter.current.kind}>
      {children}
    </div>
  );
}

/** Lets the Android shell open a route in place (a notification's deep link). */
function useNativeNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    window.tubcalNavigate = (path) => navigate(path);
    return () => { delete window.tubcalNavigate; };
  }, [navigate]);
}

function Shell() {
  useScrollMemory();
  useNativeNavigate();
  useBarsFollowTheme();
  const badges = useBadges();
  const { expandedId } = usePlayer();
  const immersive = !!expandedId;

  return (
    <>
      <div className="ph-app">
        <Suspense fallback={<Loading />}>
          <PageTransition>
          <Routes>
            <Route path="/" element={<Start />} />
            <Route path="/edition" element={<Today />} />
            <Route path="/youtube" element={<Watch />} />
            <Route path="/youtube/c/:channelId" element={<Channel />} />
            <Route path="/youtube/playlist/:playlistId" element={<Playlist />} />
            <Route path="/youtube/history" element={<History />} />
            <Route path="/hackernews" element={<Read room="wire" />} />
            <Route path="/reddit" element={<Read room="dispatch" />} />
            <Route path="/reddit/r/:sub" element={<Subreddit />} />
            <Route path="/github" element={<Read room="github" />} />
            <Route path="/anime" element={<AnimeHub />} />
            <Route path="/anime/voice/:id" element={<Reused page="voice" />} />
            <Route path="/anime/character/:id" element={<Reused page="character" />} />
            <Route path="/anime/studio/:id" element={<Reused page="studio" />} />
            <Route path="/anime/user/:name" element={<Reused page="user" />} />
            <Route path="/anime/thread/:id" element={<Reused page="thread" />} />
            <Route path="/anime/activity/:id" element={<Reused page="activity" />} />
            <Route path="/anime/:id" element={<AnimeTitle />} />
            <Route path="/archive" element={<Reused page="archive" />} />
            <Route path="/dev" element={<Reused page="dev" />} />
            <Route path="/settings" element={<Reused page="settings" />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/search" element={<Search />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </PageTransition>
        </Suspense>
      </div>
      <PhonePlayer />
      <TabBar badges={badges} hidden={immersive} />
      <CurtainCallHost />
    </>
  );
}

export default function PhoneApp() {
  return (
    <AppProviders>
      <Shell />
    </AppProviders>
  );
}
