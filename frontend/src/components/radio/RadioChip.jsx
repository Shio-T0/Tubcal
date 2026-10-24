// The bench radio in a frame's bar: shown only while an episode is tuned. Play or
// pause, what's on (back to its Workbench manual), and off.
//   variant  bar (Coding, Saved & Settings) · console (the Video console, a row of
//            its own, with the time left) · grille (Home: the set's speaker plays it)
//   compact  the button alone (the Social bar beside its sections, phones, the
//            folded console)
import { Link } from 'react-router-dom';
import { LoaderCircle, Pause, Play, X } from 'lucide-react';

import { hasModule } from '../../lib/modules.js';
import { switchOff, toggle, useRadio, useRadioClock } from '../../lib/radio.js';
import { clock } from '../../lib/time.js';
import r from './radio.module.css';

function Left() {
  const { pos, dur } = useRadioClock();
  return <em className={r.left}>{dur ? `${clock(dur - pos)} left` : clock(pos)}</em>;
}

export default function RadioChip({ variant = 'bar', compact = false }) {
  const { episode, playing, waiting } = useRadio();
  if (!episode) return null;
  const what = episode.show ? `${episode.title} — ${episode.show}` : episode.title;
  const manual = hasModule('dev') ? `/dev${episode.lang ? `?l=${episode.lang}` : ''}` : null;
  const label = (
    <>
      <span className={r.title}>{episode.title}</span>
      {variant !== 'bar' && <Left />}
    </>
  );
  return (
    <span
      className={`${r.chip} ${r[variant]} ${compact ? r.compact : ''}`}
      style={episode.accent ? { '--radio-c': episode.accent } : undefined}
      data-on={playing || undefined}
    >
      <button
        type="button"
        className={r.knob}
        onClick={toggle}
        aria-label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
        title={compact ? `${playing ? 'Pause' : 'Play'}: ${what}` : playing ? 'Pause' : 'Play'}
      >
        {playing && waiting ? <LoaderCircle size={13} className={r.spin} />
          : playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
      </button>
      {!compact && (manual ? (
        <Link to={manual} className={r.what} title={what}>{label}</Link>
      ) : (
        <span className={r.what} title={what}>{label}</span>
      ))}
      {!compact && (
        <button type="button" className={r.off} onClick={switchOff} aria-label="Turn the radio off" title="Turn the radio off">
          <X size={13} />
        </button>
      )}
    </span>
  );
}
