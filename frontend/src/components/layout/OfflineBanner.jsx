import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

import s from './OfflineBanner.module.css';

// Polls the local server; if it stops answering (e.g. the bspwm autostart died),
// surfaces a banner instead of the app silently serving stale state.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      if (document.hidden) return; // a background tab needn't knock every 15s
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (alive) setOffline(!res.ok);
      } catch {
        if (alive) setOffline(true);
      }
    };
    ping();
    const t = setInterval(ping, 15000);
    document.addEventListener('visibilitychange', ping); // ...but asks again on return
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', ping);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className={s.banner} role="alert">
      <WifiOff size={15} />
      <span>
        Lost contact with the Tubcal server on <code>{window.location.host}</code>. Showing the last
        loaded data — start the server to refresh.
      </span>
    </div>
  );
}
