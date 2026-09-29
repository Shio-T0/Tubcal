// The strip under the big screen: what you're watching and whose it is. Title in
// the display face, the channel with its face, subscriber count and a Subscribe
// button, the headline numbers, and the few things you do with a video — save
// it, copy a link to this very moment, open it on YouTube — plus the window
// controls (notes, tuck into the corner, close).

import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck, Bookmark, BookmarkCheck, ExternalLink, Link2, Minimize2, PanelRightClose, PanelRightOpen, Radio, X,
} from 'lucide-react';

import { compact } from '../../lib/format.js';
import { ago, clock } from '../../lib/time.js';
import { useShared } from '../../lib/useShared.js';
import { usePlayer, useSaved, useToast } from '../../state.jsx';
import { SubscribeButton, useSubscription } from '../screening/SubscribeButton.jsx';
import { useChannelFaces } from '../screening/tiles.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import w from './watch.module.css';

export default function WatchInfo({ item, info, isLive, getTime, notes, onMinimize, onClose }) {
  const navigate = useNavigate();
  const { minimize } = usePlayer();
  const { saved, toggleSaved } = useSaved();
  const toast = useToast();
  const faces = useChannelFaces();
  const youtube = item.platform === 'youtube';
  const vid = item.extra?.video_id;
  const cid = info?.channel_id || item.extra?.channel_id;
  const sub = useSubscription(cid);
  // A channel you don't follow has no face on file; its about card is cheap and cached.
  const about = useShared(youtube && cid && !faces.has(cid) ? `/youtube/channel/${cid}/about` : null, { maxAge: 3_600_000 });
  const face = (cid && faces.get(cid)) || about.data?.thumbnail;
  const name = info?.author || item.source || '';
  const title = info?.title || item.title;
  const isSaved = !!saved[item.id];

  const copy = async () => {
    const t = Math.floor(getTime?.() || 0);
    const url = vid ? `https://youtu.be/${vid}${t > 3 ? `?t=${t}` : ''}` : item.url;
    try {
      await navigator.clipboard.writeText(url);
      toast(t > 3 ? `Link copied — starts at ${clock(t)}` : 'Link copied', 'success');
    } catch {
      toast(url, 'info');
    }
  };
  const goChannel = () => {
    if (!cid) return;
    minimize();
    navigate(`/youtube/c/${cid}`);
  };

  return (
    <div className={w.strip}>
      <div className={w.stripTop}>
        <h2 className={w.stripTitle} title={title}>
          {isLive && <span className={w.live}><Radio size={11} /> LIVE</span>}
          {title}
        </h2>
        <div className={w.window}>
          {notes.available && (
            <button
              type="button"
              className={`${w.winBtn} ${notes.open ? w.winOn : ''}`}
              onClick={notes.toggle}
              title={notes.open ? 'Hide the notes — the picture grows' : 'Show description, chapters & comments'}
              aria-label="Toggle notes"
            >
              {notes.open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          )}
          <button type="button" className={w.winBtn} onClick={onMinimize} title="Keep playing in the corner (Esc)" aria-label="Minimize to corner">
            <Minimize2 size={15} />
          </button>
          <button type="button" className={w.winBtn} onClick={onClose} title="Stop and close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className={w.stripRow}>
        {name && (
          <button type="button" className={w.channel} onClick={goChannel} disabled={!cid} title={cid ? `Open ${name}` : undefined}>
            <Avatar src={face} name={name} imgClass={w.chFace} letterClass={w.chLetter} />
            <span className={w.chText}>
              <b>
                {name}
                {info?.channel_verified && <BadgeCheck size={13} className={w.verified} aria-label="verified" />}
              </b>
              <em>
                {info?.channel_followers != null
                  ? `${compact(info.channel_followers)} subscribers`
                  : info?.channel_handle || (youtube ? 'channel' : '')}
              </em>
            </span>
          </button>
        )}
        {youtube && cid && <SubscribeButton channelId={cid} sub={sub} name={name} small />}

        <span className={`${w.numbers} ${notes.open ? w.numbersQuiet : ''}`}>
          {info?.view_count != null && <span>{compact(info.view_count)} {isLive ? 'watching' : 'views'}</span>}
          {info?.published_at && !isLive && <span>{ago(info.published_at)}</span>}
          {info?.like_count != null && <span>{compact(info.like_count)} likes</span>}
        </span>

        <div className={w.acts}>
          <button type="button" className={`${w.act} ${isSaved ? w.actOn : ''}`} onClick={() => toggleSaved(item)} title={isSaved ? 'Remove from Saved' : 'Save for later'}>
            {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />} <span>{isSaved ? 'Saved' : 'Save'}</span>
          </button>
          <button type="button" className={w.act} onClick={copy} title="Copy a link that starts right here">
            <Link2 size={15} /> <span>Link</span>
          </button>
          {item.url && (
            <a className={w.act} href={item.url} target="_blank" rel="noopener noreferrer" title={youtube ? 'Open on YouTube' : 'Open the source'}>
              <ExternalLink size={14} /> <span>{youtube ? 'YouTube' : 'Source'}</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
