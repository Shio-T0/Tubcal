// The bench radio's one <audio>; lib/radio.js holds what's tuned. Mounted once at
// the app's root, so an episode keeps playing in whatever room you go to (on the
// phone the Workbench mounts it itself, and the radio stays that page's). It also:
// - keeps one sound at a time: a video starting, or a muted one turning audible,
//   pauses the radio, and the radio starting pauses whatever else is playing;
// - puts the radio under the sleep timer, as the player is;
// - tells the system's media controls what's on, through a pause too, until the
//   radio goes off or something else takes over the sound.
import { useEffect, useRef } from 'react';

import {
  attach, heardEnd, heardLeave, heardPause, heardPlay, heardPlaying, heardTime, heardWaiting,
  switchOff, tunedEpisode, useRadio,
} from '../../lib/radio.js';
import { fallAsleep, stopsAtEnd, useSleepFade } from '../../lib/sleepTimer.js';
import { useToast } from '../../state.jsx';

const audible = (m) => !m.paused && !m.muted && m.volume > 0;
const session = typeof navigator !== 'undefined' && 'mediaSession' in navigator
  && typeof MediaMetadata !== 'undefined' ? navigator.mediaSession : null;

export default function RadioHost() {
  const ref = useRef(null);
  const toast = useToast();
  const { episode, playing } = useRadio();

  useEffect(() => {
    const el = ref.current;
    const detach = attach(el);
    const onPlay = () => {
      heardPlay();
      document.querySelectorAll('video, audio').forEach((m) => { if (m !== el && audible(m)) m.pause(); });
    };
    const onEnd = () => {
      heardEnd();
      if (stopsAtEnd()) fallAsleep({ atEnd: true });
    };
    const onError = () => {
      if (!el.getAttribute('src')) return; // switched off, not broken
      const title = tunedEpisode()?.title;
      switchOff();
      toast(title ? `“${title}” wouldn't load, so the radio is off.` : "That episode wouldn't load, so the radio is off.", 'error');
    };
    const yieldTo = (e) => {
      const m = e.target;
      if (m === el || !(m instanceof HTMLMediaElement) || !audible(m) || !tunedEpisode()) return;
      el.pause();
      if (session) session.metadata = null; // the system's controls are the video's now
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('playing', heardPlaying);
    el.addEventListener('waiting', heardWaiting);
    el.addEventListener('pause', heardPause);
    el.addEventListener('timeupdate', heardTime);
    el.addEventListener('durationchange', heardTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onError);
    // media events don't bubble, so listen on the way down
    document.addEventListener('play', yieldTo, true);
    document.addEventListener('volumechange', yieldTo, true);
    window.addEventListener('pagehide', heardLeave);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('playing', heardPlaying);
      el.removeEventListener('waiting', heardWaiting);
      el.removeEventListener('pause', heardPause);
      el.removeEventListener('timeupdate', heardTime);
      el.removeEventListener('durationchange', heardTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onError);
      document.removeEventListener('play', yieldTo, true);
      document.removeEventListener('volumechange', yieldTo, true);
      window.removeEventListener('pagehide', heardLeave);
      detach();
    };
  }, [toast]);

  useSleepFade(ref);

  // Named when it plays; a pause keeps the name, so the system's controls can
  // bring it back. A new episode or switching off clears it.
  useEffect(() => {
    if (!session || !episode || !playing) return;
    session.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.show || '',
      artwork: episode.show_art ? [{ src: episode.show_art }] : [],
    });
  }, [episode, playing]);
  useEffect(() => () => { if (session) session.metadata = null; }, [episode]);

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio ref={ref} preload="none" />;
}
