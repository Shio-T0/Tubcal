import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { api } from './api/client.js';
import ToastStack from './components/ui/Toast.jsx';

const ToastCtx = createContext(() => {});
const SettingsCtx = createContext(null);
const SubsCtx = createContext(null);
const PlayerCtx = createContext(null);
const ProgressCtx = createContext(null);

export const useToast = () => useContext(ToastCtx);
export const useSettings = () => useContext(SettingsCtx);
export const useSubscriptions = () => useContext(SubsCtx);
export const usePlayer = () => useContext(PlayerCtx);
export const useProgress = () => useContext(ProgressCtx);

// A video counts as "finished" once you're within the last 5% of it.
export const COMPLETE_RATIO = 0.95;

function recordWatch(item) {
  api('/history', { method: 'POST', body: JSON.stringify({ item }) }).catch(() => {});
}

export function AppProviders({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const [settings, setSettings] = useState(null);
  useEffect(() => {
    api('/settings')
      .then(setSettings)
      .catch(() => setSettings({ theme: 'dark' }));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme || 'dark';
  }, [settings?.theme]);

  const updateSettings = useCallback(
    async (partial) => {
      setSettings((s) => ({ ...s, ...partial }));
      try {
        setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify(partial) }));
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    [toast],
  );

  const [subs, setSubs] = useState({ youtube: [], reddit: [] });
  const refreshSubs = useCallback(async () => {
    try {
      setSubs(await api('/subscriptions'));
    } catch {
      /* server unreachable — keep what we have */
    }
  }, []);
  useEffect(() => {
    refreshSubs();
  }, [refreshSubs]);

  // Global video player. `players` is the stable mount-ordered list of every
  // active video (never reordered, so React never remounts an <iframe> — that's
  // what kept resetting playback). `expandedId` is the one shown full-size;
  // `order` is the display order of the docked (corner) videos, last = corner.
  // Reordering and minimizing only change styling/coordinates, never DOM order,
  // so the iframes keep playing.
  const [pstate, setPstate] = useState({ players: [], expandedId: null, order: [] });

  const openVideo = useCallback((item) => {
    if (!item) return;
    recordWatch(item);
    setPstate((st) => {
      const players = st.players.some((x) => x.id === item.id)
        ? st.players
        : [...st.players, { id: item.id, item }];
      let order = st.order.filter((x) => x !== item.id);
      // a previously expanded video keeps playing — send it to the corner
      if (st.expandedId && st.expandedId !== item.id && !order.includes(st.expandedId)) {
        order = [...order, st.expandedId];
      }
      return { players, expandedId: item.id, order };
    });
  }, []);

  // Close the expanded video entirely (stop it).
  const closeVideo = useCallback(() => {
    setPstate((st) =>
      st.expandedId
        ? {
            players: st.players.filter((x) => x.id !== st.expandedId),
            order: st.order.filter((x) => x !== st.expandedId),
            expandedId: null,
          }
        : st,
    );
  }, []);

  // Minimize the expanded video into the corner stack (keeps playing).
  const minimizeVideo = useCallback(() => {
    setPstate((st) => {
      if (!st.expandedId) return st;
      const order = st.order.includes(st.expandedId) ? st.order : [...st.order, st.expandedId];
      return { ...st, expandedId: null, order };
    });
  }, []);

  // Remove a docked video.
  const undockVideo = useCallback((id) => {
    setPstate((st) => ({
      players: st.players.filter((x) => x.id !== id),
      order: st.order.filter((x) => x !== id),
      expandedId: st.expandedId === id ? null : st.expandedId,
    }));
  }, []);

  // Pull a docked video back to full size.
  const expandVideo = useCallback((id) => {
    setPstate((st) => {
      let order = st.order.filter((x) => x !== id);
      if (st.expandedId && st.expandedId !== id && !order.includes(st.expandedId)) {
        order = [...order, st.expandedId];
      }
      return { players: st.players, expandedId: id, order };
    });
  }, []);

  // Reorder the corner stack by display index.
  const reorderDocked = useCallback((from, to) => {
    setPstate((st) => {
      const o = st.order;
      if (from === to || from < 0 || to < 0 || from >= o.length || to >= o.length) return st;
      const next = [...o];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...st, order: next };
    });
  }, []);

  // Playback progress for every video, keyed by item id. Loaded once from the
  // server, then kept live as videos play so resume + tile progress bars work
  // anywhere the same video appears.
  const [progress, setProgressMap] = useState({});
  useEffect(() => {
    api('/progress')
      .then((d) => setProgressMap(d?.progress || {}))
      .catch(() => {});
  }, []);

  // Per-id bookkeeping so we don't re-render every tile (map) or hit the server
  // (POST) on every single time-update tick coming from the player.
  const progMeta = useRef({});
  const writeProgress = useCallback((id, position, duration) => {
    if (!id || !duration) return;
    const meta = progMeta.current[id] || (progMeta.current[id] = { mapPos: -10, sent: 0 });
    if (Math.abs(position - meta.mapPos) >= 1) {
      meta.mapPos = position;
      setProgressMap((p) => ({ ...p, [id]: { position, duration } }));
    }
    const now = Date.now();
    if (now - meta.sent >= 5000) {
      meta.sent = now;
      api('/progress', {
        method: 'POST',
        body: JSON.stringify({ item_id: id, position, duration }),
      }).catch(() => {});
    }
  }, []);

  // Force an immediate save (on pause / minimize / close / unmount).
  const flushProgress = useCallback((id, position, duration) => {
    if (!id || !duration) return;
    const meta = progMeta.current[id] || (progMeta.current[id] = { mapPos: -10, sent: 0 });
    meta.mapPos = position;
    meta.sent = Date.now();
    setProgressMap((p) => ({ ...p, [id]: { position, duration } }));
    api('/progress', {
      method: 'POST',
      body: JSON.stringify({ item_id: id, position, duration }),
    }).catch(() => {});
  }, []);

  const progressApi = { progress, writeProgress, flushProgress };

  const player = {
    players: pstate.players,
    expandedId: pstate.expandedId,
    order: pstate.order,
    open: openVideo,
    close: closeVideo,
    minimize: minimizeVideo,
    undock: undockVideo,
    expandFromDock: expandVideo,
    reorder: reorderDocked,
  };

  return (
    <ToastCtx.Provider value={toast}>
      <SettingsCtx.Provider value={{ settings, updateSettings }}>
        <SubsCtx.Provider value={{ subs, refreshSubs }}>
          <PlayerCtx.Provider value={player}>
            <ProgressCtx.Provider value={progressApi}>
              {children}
              <ToastStack toasts={toasts} />
            </ProgressCtx.Provider>
          </PlayerCtx.Provider>
        </SubsCtx.Provider>
      </SettingsCtx.Provider>
    </ToastCtx.Provider>
  );
}
