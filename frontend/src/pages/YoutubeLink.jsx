// Where a YouTube link from another app lands (/youtube/open). On the desktop the
// link handler (server/youtube_links.py) sends it here; on the phone the Android
// shell does, after asking the server the same thing (/api/youtube/link).
//   ?v=<id>&t=<s>    the video plays, from that second, over the Screening Room
//   ?channel=@name   the handle is looked up, then its channel page opens
// Either way this page replaces itself, so Back doesn't return to it.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clapperboard, ExternalLink } from 'lucide-react';

import { api } from '../api/client.js';
import { metaPath, videoItem } from '../components/player/watchLinks.js';
import { EmptyState, Spinner } from '../components/ui/index.jsx';
import { fetchShared } from '../lib/useShared.js';
import { usePlayer } from '../state.jsx';

export default function YoutubeLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { open } = usePlayer();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const v = params.get('v');
  const t = Number(params.get('t')) || 0;
  const channel = params.get('channel');
  const youtube = v
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(v)}${t ? `&t=${t}s` : ''}`
    : `https://www.youtube.com/${channel ? encodeURIComponent(channel).replace(/^%40/, '@') : ''}`;

  const key = params.toString();
  useEffect(() => {
    if (started.current === key) return; // StrictMode's second run
    started.current = key;
    if (v) {
      // Details first, as a link pressed inside Tubcal does, so history gets the
      // title and channel; a removed video gets the offer of YouTube instead.
      fetchShared(metaPath(v), 600_000)
        .then((d) => {
          open(videoItem(v, d), t ? { start: t } : {});
          navigate('/youtube', { replace: true });
        })
        .catch(() => setFailed(true));
    } else if (channel) {
      api('/youtube/resolve', { method: 'POST', body: JSON.stringify({ input: channel }) })
        .then((c) => navigate(`/youtube/c/${c.channel_id}`, { replace: true }))
        .catch(() => setFailed(true));
    } else {
      navigate('/youtube', { replace: true });
    }
  }, [key, v, t, channel, open, navigate]);

  if (failed) {
    return (
      <EmptyState
        icon={<Clapperboard size={32} />}
        color="var(--c-youtube)"
        title={v ? "This video couldn't be loaded" : `${channel} couldn't be found`}
        subtitle={v ? 'It may have been removed or made private.' : 'The handle may be wrong, or YouTube didn’t answer.'}
        action={(
          <a href={youtube} rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={15} /> Open it on YouTube
          </a>
        )}
      />
    );
  }
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 12, minHeight: '50vh', color: 'var(--paper-dim)' }}>
      <Spinner />
      <span>{v ? 'Opening the video…' : 'Looking up the channel…'}</span>
    </div>
  );
}
